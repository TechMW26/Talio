/**
 * Holiday Sync Cron Job - FULLY SELF-CONTAINED
 * 
 * Periodically fetches public holidays from Google Calendar API and syncs them
 * to every active tenant's database. Ensures no holidays are missing.
 * 
 * This file is loaded by server.js via raw Node.js import() - NOT through
 * Next.js bundler. Therefore it CANNOT use @/ path aliases or import any
 * lib/ or models/ files that use them internally. It uses mongoose directly.
 * 
 * Schedule: Runs daily at 2:00 AM server time + once on server startup (after 30s delay).
 * 
 * Required env variables:
 *   GOOGLE_CALENDAR_API_KEY   - API key from Google Cloud Console
 *   GOOGLE_CALENDAR_COUNTRY   - Country code (default: 'indian')
 *   HOLIDAY_SYNC_ENABLED      - Set to 'false' to disable (default: enabled)
 *   HOLIDAY_SYNC_CRON         - Custom cron expression (default: '0 2 * * *' = daily 2 AM)
 */

const schedule = require('node-schedule');
const mongoose = require('mongoose');
const dns = require('dns');

// Use Google/Cloudflare DNS for reliable SRV resolution (matches superadminDb.js)
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

// ============================================================================
// Self-contained DB helpers (avoids importing lib/ files that use @/ aliases)
// ============================================================================

const MONGODB_URI = process.env.MONGODB_URI;

function getDatabaseUri(databaseName) {
    if (!MONGODB_URI) throw new Error('MONGODB_URI environment variable is not defined');
    const match = MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?([^?]*)?(\?.*)?$/);
    if (!match) throw new Error('Invalid MONGODB_URI format');
    return `${match[1]}/${databaseName}${match[3] || ''}`;
}

// Connection caches
let superadminConn = null;
const tenantConns = new Map();

const CONN_OPTIONS = {
    bufferCommands: true,
    maxPoolSize: 3,
    minPoolSize: 1,
    socketTimeoutMS: 30000,
    connectTimeoutMS: 15000,
    serverSelectionTimeoutMS: 15000,
    family: 4,
    retryWrites: true,
    retryReads: true,
};

async function getSuperadminConnection() {
    if (superadminConn && superadminConn.readyState === 1) return superadminConn;
    if (superadminConn) { try { await superadminConn.close(); } catch { } superadminConn = null; }
    superadminConn = await mongoose.createConnection(getDatabaseUri('talio_superadmin'), CONN_OPTIONS).asPromise();
    return superadminConn;
}

async function getTenantConnection(databaseName) {
    const existing = tenantConns.get(databaseName);
    if (existing && existing.readyState === 1) return existing;
    if (existing) { try { await existing.close(); } catch { } tenantConns.delete(databaseName); }
    const conn = await mongoose.createConnection(getDatabaseUri(databaseName), CONN_OPTIONS).asPromise();
    tenantConns.set(databaseName, conn);
    return conn;
}

// Minimal schemas - just enough for the sync queries
const TenantCompanyMiniSchema = new mongoose.Schema({
    name: String, slug: String, databaseName: String, serviceStatus: String,
}, { strict: false, collection: 'tenantcompanies' });

const HolidaySchema = new mongoose.Schema({
    name: { type: String, required: true },
    date: { type: Date, required: true },
    endDate: Date,
    type: { type: String, enum: ['public', 'company'], default: 'public' },
    isActive: { type: Boolean, default: true },
    applicableDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
    year: Number,
    description: String,
}, { timestamps: true, strict: false });

function getModel(connection, name, schema) {
    return connection.models[name] || connection.model(name, schema);
}

// ============================================================================
// Google Calendar helpers (mirrored from app/api/holidays/google-calendar/route.js)
// ============================================================================

const COUNTRY_CALENDAR_MAP = {
    'india': 'indian', 'us': 'usa', 'united states': 'usa',
    'united kingdom': 'uk', 'australia': 'australian', 'canada': 'canadian',
    'france': 'french', 'germany': 'german', 'japan': 'japanese',
    'china': 'chinese', 'brazil': 'brazilian', 'mexico': 'mexican',
    'south korea': 'south_korea', 'singapore': 'singapore', 'malaysia': 'malaysia',
    'indonesia': 'indonesian', 'italy': 'italian', 'spain': 'spanish',
    'netherlands': 'dutch', 'sweden': 'swedish', 'norway': 'norwegian',
    'denmark': 'danish', 'finland': 'finnish', 'portugal': 'portuguese',
    'russia': 'russian', 'poland': 'polish', 'turkey': 'turkish',
    'saudi arabia': 'sa', 'uae': 'ae', 'united arab emirates': 'ae',
    'new zealand': 'new_zealand', 'south africa': 'south_africa',
    'thailand': 'thai', 'philippines': 'philippines', 'vietnam': 'vietnamese',
    'pakistan': 'pakistan', 'bangladesh': 'bangladesh', 'sri lanka': 'sri_lanka',
    'nepal': 'nepal',
};

function resolveCalendarId(country) {
    const lower = country.toLowerCase().trim();
    const slug = COUNTRY_CALENDAR_MAP[lower] || lower;
    return `en.${slug}%23holiday%40group.v.calendar.google.com`;
}

/**
 * Check if a Google Calendar event is a public holiday.
 * Returns true only for public holidays; observances, optional, and restricted holidays are discarded.
 */
function isPublicHoliday(description = '') {
    const lower = description.toLowerCase();
    if (lower.includes('optional') || lower.includes('restricted')) return false;
    if (lower.includes('observance')) return false;
    return true;
}

// ============================================================================
// Core sync logic
// ============================================================================

/**
 * Fetch holidays from Google Calendar API for a given year & country
 * @returns {Array} Array of processed holiday event objects, or null on error
 */
async function fetchGoogleCalendarHolidays(apiKey, country, year) {
    const timeMin = new Date(year, 0, 1).toISOString();
    const timeMax = new Date(year, 11, 31, 23, 59, 59).toISOString();
    const calendarId = resolveCalendarId(country);

    const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?` +
        `key=${apiKey}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=100`;

    const response = await fetch(url);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google Calendar API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data.items || [];
}

/**
 * Sync holidays from Google Calendar events into a tenant's Holiday model.
 * Upserts: creates missing holidays, updates existing ones.
 * 
 * @param {Model} Holiday - Mongoose Holiday model (tenant-specific)
 * @param {Array} events - Google Calendar event objects
 * @param {number} year - Year being synced
 * @returns {{ added: number, updated: number, skipped: number }}
 */
async function syncHolidaysForTenant(Holiday, events, year) {
    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const event of events) {
        const name = event.summary;
        if (!name) { skipped++; continue; }

        const dateStr = event.start?.date || event.start?.dateTime;
        if (!dateStr) { skipped++; continue; }

        const holidayDate = new Date(dateStr);

        // Determine end date (Google all-day event end is exclusive - next day)
        let endDate = null;
        if (event.end?.date) {
            const rawEnd = new Date(event.end.date);
            rawEnd.setDate(rawEnd.getDate() - 1);
            if (rawEnd.getTime() !== holidayDate.getTime()) {
                endDate = rawEnd;
            }
        }

        // Only keep public holidays — skip optional, restricted, observances
        if (!isPublicHoliday(event.description || '')) { skipped++; continue; }

        const holidayData = {
            name,
            date: holidayDate,
            endDate,
            type: 'public',
            description: event.description || `${name} - Public Holiday`,
            year: parseInt(year),
            applicableTo: 'all',
            isActive: true,
            source: 'google-calendar',
            googleEventId: event.id || null,
        };

        try {
            // Find existing google-calendar holiday by googleEventId or name+date
            let existing = null;
            if (event.id) {
                existing = await Holiday.findOne({ googleEventId: event.id });
            }
            if (!existing) {
                existing = await Holiday.findOne({
                    source: 'google-calendar',
                    name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
                    date: {
                        $gte: new Date(holidayDate.getFullYear(), holidayDate.getMonth(), holidayDate.getDate()),
                        $lt: new Date(holidayDate.getFullYear(), holidayDate.getMonth(), holidayDate.getDate() + 1),
                    },
                });
            }

            if (existing) {
                // Only update google-calendar sourced holidays - never overwrite manual ones
                existing.description = holidayData.description;
                existing.type = holidayData.type;
                existing.googleEventId = event.id || existing.googleEventId;
                if (endDate) existing.endDate = endDate;
                await existing.save();
                updated++;
            } else {
                await Holiday.create(holidayData);
                added++;
            }
        } catch (err) {
            // Log but don't stop - continue with remaining holidays
            console.warn(`  ⚠️ [HolidaySync] Error processing "${name}":`, err.message);
            skipped++;
        }
    }

    return { added, updated, skipped };
}

// ============================================================================
// Main sync job - iterates over all active tenants
// ============================================================================

async function runHolidaySync() {
    const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
    if (!apiKey) {
        console.log('📅 [HolidaySync] Skipped - GOOGLE_CALENDAR_API_KEY not set');
        return;
    }

    const country = process.env.GOOGLE_CALENDAR_COUNTRY || 'indian';
    const currentYear = new Date().getFullYear();
    const startTime = Date.now();

    console.log(`📅 [HolidaySync] Starting sync for "${country}" (${currentYear})...`);

    // 1. Fetch holidays from Google Calendar once (shared across all tenants)
    let events;
    try {
        events = await fetchGoogleCalendarHolidays(apiKey, country, currentYear);
        console.log(`📅 [HolidaySync] Fetched ${events.length} holidays from Google Calendar`);
    } catch (err) {
        console.error('❌ [HolidaySync] Failed to fetch from Google Calendar:', err.message);
        return;
    }

    if (!events.length) {
        console.log('📅 [HolidaySync] No holidays found - skipping tenant sync');
        return;
    }

    // 2. Get all active tenant companies
    let tenants;
    try {
        const saConn = await getSuperadminConnection();
        const TenantCompany = getModel(saConn, 'TenantCompany', TenantCompanyMiniSchema);
        tenants = await TenantCompany.find({
            serviceStatus: 'active',
            databaseName: { $exists: true, $ne: null },
        }).select('name slug databaseName').lean();
    } catch (err) {
        console.error('❌ [HolidaySync] Failed to fetch tenants:', err.message);
        return;
    }

    if (!tenants.length) {
        console.log('📅 [HolidaySync] No active tenants found');
        return;
    }

    console.log(`📅 [HolidaySync] Syncing to ${tenants.length} active tenant(s)...`);

    // 3. Sync holidays to each tenant
    let successCount = 0;
    let failCount = 0;

    for (const tenant of tenants) {
        try {
            const tenantConn = await getTenantConnection(tenant.databaseName);
            const Holiday = getModel(tenantConn, 'Holiday', HolidaySchema);

            const result = await syncHolidaysForTenant(Holiday, events, currentYear);

            if (result.added > 0 || result.updated > 0) {
                console.log(`  ✅ ${tenant.name}: +${result.added} added, ~${result.updated} updated, ${result.skipped} skipped`);
            }
            successCount++;
        } catch (err) {
            console.error(`  ❌ ${tenant.name} (${tenant.databaseName}):`, err.message);
            failCount++;
        }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`📅 [HolidaySync] Done in ${duration}s - ${successCount} tenants synced, ${failCount} failed`);
}

// ============================================================================
// Scheduler setup
// ============================================================================

let scheduledJob = null;

/**
 * Start the periodic holiday sync cron job.
 * Called from server.js after the server boots.
 */
function startHolidaySyncCron() {
    // Allow disabling via env
    if (process.env.HOLIDAY_SYNC_ENABLED === 'false') {
        console.log('📅 [HolidaySync] Disabled via HOLIDAY_SYNC_ENABLED=false');
        return;
    }

    // Don't start if no API key (will just skip each run anyway, but avoid noisy logs)
    if (!process.env.GOOGLE_CALENDAR_API_KEY) {
        console.log('📅 [HolidaySync] Cron not started - GOOGLE_CALENDAR_API_KEY not set');
        return;
    }

    // Schedule: default daily at 2:00 AM, configurable via env
    const cronExpression = process.env.HOLIDAY_SYNC_CRON || '0 2 * * *';

    scheduledJob = schedule.scheduleJob(cronExpression, async () => {
        try {
            await runHolidaySync();
        } catch (err) {
            console.error('❌ [HolidaySync] Unhandled cron error:', err);
        }
    });

    console.log(`📅 [HolidaySync] Cron scheduled: "${cronExpression}" (next: ${scheduledJob?.nextInvocation?.()?.toLocaleString() || 'unknown'})`);

    // Also run once on startup after a 30-second delay (let DB connections warm up)
    setTimeout(async () => {
        console.log('📅 [HolidaySync] Running initial startup sync...');
        try {
            await runHolidaySync();
        } catch (err) {
            console.error('❌ [HolidaySync] Startup sync error:', err);
        }
    }, 30_000);
}

/**
 * Stop the scheduled cron job (called during graceful shutdown).
 */
function stopHolidaySyncCron() {
    if (scheduledJob) {
        scheduledJob.cancel();
        scheduledJob = null;
        console.log('📅 [HolidaySync] Cron stopped');
    }
}

module.exports = { startHolidaySyncCron, stopHolidaySyncCron, runHolidaySync };
