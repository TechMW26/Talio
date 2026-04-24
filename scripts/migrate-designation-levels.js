/**
 * Migration Script: Designation Level Normalisation
 *
 * Standardises Designation.level + Employee.designationLevel + Employee.designationLevelName
 * to the new convention used by the org hierarchy chart:
 *
 *   L7  Director         (top of org tree)
 *   L6  C-Suite          (CEO, CTO, CMO, COO, CFO, CHRO, CIO, CISO, Chief X)
 *   L5  Manager / Sr Manager / Head / Asst. Director
 *   L4  Team Lead / Lead / Supervisor
 *   L3  Senior IC
 *   L2  Mid IC           (default IC)
 *   L1  Junior / Entry / Intern / Trainee
 *
 * USAGE:
 *   node scripts/migrate-designation-levels.js                  # dry-run
 *   DRY_RUN=false node scripts/migrate-designation-levels.js    # apply
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const DRY_RUN = process.env.DRY_RUN !== 'false';

const LEVEL_NAMES = {
    7: 'Director',
    6: 'C-Suite',
    5: 'Manager',
    4: 'Team Lead',
    3: 'Senior',
    2: 'Mid Level',
    1: 'Entry Level',
};

function inferLevelFromTitle(title) {
    const t = (title || '').toLowerCase().trim();
    if (!t) return 2;
    if (/(intern|trainee|apprentice)/.test(t)) return 1;
    if (/\b(jr|junior)\b/.test(t)) return 1;
    if (/(asst\.?|assistant)\s*director/.test(t)) return 5;
    if (/\bdirector\b/.test(t)) return 7;
    if (/(c[etoamfhi]o|chief|president|founder|\bceo\b|\bcto\b|\bcfo\b|\bcmo\b|\bcoo\b|\bchro\b|\bciso\b|\bcio\b|\bcpo\b)/.test(t)) return 6;
    if (/(senior\s*manager|sr\.?\s*manager|principal|head\s*of|\bhead\b)/.test(t)) return 5;
    if (/(manager|architect)/.test(t)) return 5;
    if (/(team\s*lead|tech\s*lead|\blead\b|supervisor)/.test(t)) return 4;
    if (/(senior|sr\.?)/.test(t)) return 3;
    return 2;
}

const stats = {
    databases: 0,
    designationsChecked: 0,
    designationsUpdated: 0,
    employeesChecked: 0,
    employeesUpdated: 0,
    errors: [],
};

function log(msg, data) {
    console.log(`[DESIGNATION-LEVELS] ${msg}`, data || '');
}

async function migrateTenantDatabase(uri, dbName) {
    log(`→ ${dbName}`);
    let conn;
    try {
        conn = await mongoose.createConnection(uri, {
            dbName,
            maxPoolSize: 5,
            serverSelectionTimeoutMS: 10000,
        }).asPromise();

        const designations = conn.collection('designations');
        const employees = conn.collection('employees');

        // 1. Update Designation docs
        const allDesignations = await designations.find({}).toArray();
        stats.designationsChecked += allDesignations.length;

        const designationLevelMap = new Map(); // designationId -> { level, levelName }

        for (const d of allDesignations) {
            const title = (typeof d.title === 'object' ? d.title?.name : d.title) || d.name || '';
            const newLevel = inferLevelFromTitle(title);
            const newLevelName = LEVEL_NAMES[newLevel];
            designationLevelMap.set(String(d._id), { level: newLevel, levelName: newLevelName });

            if (d.level !== newLevel || d.levelName !== newLevelName) {
                if (DRY_RUN) {
                    log(`  [DRY] Designation "${title}" (${d._id}): L${d.level || '?'} → L${newLevel} (${newLevelName})`);
                } else {
                    await designations.updateOne(
                        { _id: d._id },
                        { $set: { level: newLevel, levelName: newLevelName } }
                    );
                }
                stats.designationsUpdated++;
            }
        }

        // 2. Update Employees: align with their designation
        const allEmployees = await employees.find({}).toArray();
        stats.employeesChecked += allEmployees.length;

        for (const e of allEmployees) {
            let target = null;
            if (e.designation && designationLevelMap.has(String(e.designation))) {
                target = designationLevelMap.get(String(e.designation));
            } else {
                // No designation ref — infer from designationLevelName/jobTitle
                const fallback = e.designationLevelName || e.jobTitle || '';
                const lvl = inferLevelFromTitle(fallback);
                target = { level: lvl, levelName: LEVEL_NAMES[lvl] };
            }

            if (e.designationLevel !== target.level || e.designationLevelName !== target.levelName) {
                if (DRY_RUN) {
                    log(`  [DRY] Employee ${e.firstName || ''} ${e.lastName || ''}: L${e.designationLevel || '?'} → L${target.level} (${target.levelName})`);
                } else {
                    await employees.updateOne(
                        { _id: e._id },
                        { $set: { designationLevel: target.level, designationLevelName: target.levelName } }
                    );
                }
                stats.employeesUpdated++;
            }
        }

        log(`  ✔ ${dbName}: ${stats.designationsUpdated} designations, ${stats.employeesUpdated} employees normalised`);
    } catch (err) {
        log(`  ✖ ${dbName} failed: ${err.message}`);
        stats.errors.push({ db: dbName, error: err.message });
    } finally {
        if (conn) await conn.close();
    }
}

async function main() {
    log('────────────────────────────────────────────');
    log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : '⚠️  LIVE'}`);
    log('────────────────────────────────────────────');

    const superadminUri = process.env.SUPERADMIN_DB_URI;
    const fallbackUri = process.env.MONGODB_URI;

    if (!superadminUri && !fallbackUri) {
        log('Missing SUPERADMIN_DB_URI or MONGODB_URI');
        process.exit(1);
    }

    try {
        // Strategy 1: Use SUPERADMIN_DB_URI if available
        if (superadminUri) {
            const superConn = await mongoose.createConnection(superadminUri, {
                maxPoolSize: 3,
                serverSelectionTimeoutMS: 10000,
            }).asPromise();

            const tenants = await superConn.collection('tenants')
                .find({ isActive: { $ne: false } })
                .project({ databaseName: 1, companyName: 1 })
                .toArray();
            stats.databases = tenants.length;
            log(`Found ${tenants.length} active tenants via SUPERADMIN_DB_URI`);

            for (const t of tenants) {
                const tenantUri = fallbackUri || superadminUri.replace(/\/[^/?]+(\?|$)/, `/${t.databaseName}$1`);
                await migrateTenantDatabase(tenantUri, t.databaseName);
            }
            await superConn.close();
        } else {
            // Strategy 2: Enumerate all `talio_company_*` databases on the cluster directly,
            // plus check `talio_superadmin` for any tenants we may have missed.
            const adminConn = await mongoose.createConnection(fallbackUri, {
                maxPoolSize: 3,
                serverSelectionTimeoutMS: 10000,
            }).asPromise();

            const adminDb = adminConn.getClient().db().admin();
            const dbList = await adminDb.listDatabases();
            const tenantDbs = dbList.databases
                .map((d) => d.name)
                .filter((n) => /^talio_company_/i.test(n));

            // Also try to read tenants from talio_superadmin
            try {
                const superDb = adminConn.getClient().db('talio_superadmin');
                const tenants = await superDb.collection('tenants')
                    .find({ isActive: { $ne: false } })
                    .project({ databaseName: 1 })
                    .toArray();
                for (const t of tenants) {
                    if (t.databaseName && !tenantDbs.includes(t.databaseName)) tenantDbs.push(t.databaseName);
                }
            } catch (_) { /* superadmin DB may not exist */ }

            stats.databases = tenantDbs.length;
            log(`Found ${tenantDbs.length} tenant databases on cluster: ${tenantDbs.join(', ') || '(none)'}`);

            await adminConn.close();

            for (const dbName of tenantDbs) {
                await migrateTenantDatabase(fallbackUri, dbName);
            }
        }

        log('────────────────────────────────────────────');
        log('SUMMARY', stats);
        log('────────────────────────────────────────────');
    } catch (err) {
        log(`Fatal: ${err.message}`);
        process.exit(1);
    } finally {
        await mongoose.disconnect().catch(() => {});
    }
}

main();
