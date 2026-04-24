/**
 * Migration: bump legacy 1-7 designation levels into the new 1-9 scheme.
 *
 * Legacy → New:
 *   L1 Entry        → L1 Entry Level
 *   L2 Mid          → L2 Mid Level
 *   L3 Senior       → L3 Senior
 *   L4 Team Lead    → L4 Team Lead
 *   L5 Manager      → L6 Manager
 *   L6 C-Suite      → L7 C-Suite
 *   L7 Director     → L9 Director
 *   L8 (legacy)     → L7 C-Suite      (defensive fallback)
 *
 * The new mid-tier slots created (L5 Assistant Manager, L8 Assistant Director) are
 * intentionally left unpopulated — assign them via the UI after migration.
 *
 * USAGE:
 *   node scripts/bump-levels-to-1-9.js                  # dry-run
 *   DRY_RUN=false node scripts/bump-levels-to-1-9.js    # apply
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const DRY_RUN = process.env.DRY_RUN !== 'false';

const NEW_LEVEL_NAMES = {
    1: 'Entry Level',
    2: 'Mid Level',
    3: 'Senior',
    4: 'Team Lead',
    5: 'Assistant Manager',
    6: 'Manager',
    7: 'C-Suite',
    8: 'Assistant Director',
    9: 'Director',
};

// Legacy → new mapping. Anything already in 1-9 that isn't in this map is left alone.
const LEVEL_REMAP = {
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    5: 6, // Manager moves up one slot
    6: 7, // C-Suite moves up one slot
    7: 9, // Director moves to the very top
    8: 7, // legacy "Executive" treated as C-Suite
};

function mapLegacyLevel(level) {
    const n = Number(level);
    if (!n || Number.isNaN(n)) return null;
    return LEVEL_REMAP[n] ?? n;
}

const stats = {
    databases: 0,
    designationsChecked: 0,
    designationsUpdated: 0,
    employeesChecked: 0,
    employeesUpdated: 0,
    skippedAlreadyMigrated: 0,
    errors: [],
};

function log(msg, data) {
    console.log(`[BUMP-1-9] ${msg}`, data || '');
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

        // Idempotency check: if any designation or employee already sits at level 8 or 9,
        // assume this DB has already been bumped and skip it.
        const alreadyMigratedDesignation = await designations.findOne({ level: { $in: [8, 9] } });
        const alreadyMigratedEmployee = await employees.findOne({ designationLevel: { $in: [8, 9] } });
        if (alreadyMigratedDesignation || alreadyMigratedEmployee) {
            log(`  ⤳ ${dbName}: already on 1-9 scheme, skipping`);
            stats.skippedAlreadyMigrated++;
            return;
        }

        // 1. Designations
        const allDesignations = await designations.find({}).toArray();
        stats.designationsChecked += allDesignations.length;
        for (const d of allDesignations) {
            const newLevel = mapLegacyLevel(d.level);
            if (!newLevel) continue;
            const newLevelName = NEW_LEVEL_NAMES[newLevel];
            if (d.level === newLevel && d.levelName === newLevelName) continue;
            if (DRY_RUN) {
                const title = (typeof d.title === 'object' ? d.title?.name : d.title) || d.name || '(untitled)';
                log(`  [DRY] Designation "${title}" (${d._id}): L${d.level || '?'} → L${newLevel} (${newLevelName})`);
            } else {
                await designations.updateOne(
                    { _id: d._id },
                    { $set: { level: newLevel, levelName: newLevelName } }
                );
            }
            stats.designationsUpdated++;
        }

        // 2. Employees
        const allEmployees = await employees.find({}).toArray();
        stats.employeesChecked += allEmployees.length;
        for (const e of allEmployees) {
            const newLevel = mapLegacyLevel(e.designationLevel);
            if (!newLevel) continue;
            const newLevelName = NEW_LEVEL_NAMES[newLevel];
            if (e.designationLevel === newLevel && e.designationLevelName === newLevelName) continue;
            if (DRY_RUN) {
                log(`  [DRY] Employee ${e.firstName || ''} ${e.lastName || ''}: L${e.designationLevel || '?'} → L${newLevel} (${newLevelName})`);
            } else {
                await employees.updateOne(
                    { _id: e._id },
                    { $set: { designationLevel: newLevel, designationLevelName: newLevelName } }
                );
            }
            stats.employeesUpdated++;
        }

        log(`  ✔ ${dbName}: designations updated so far=${stats.designationsUpdated}, employees updated so far=${stats.employeesUpdated}`);
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
            const adminConn = await mongoose.createConnection(fallbackUri, {
                maxPoolSize: 3,
                serverSelectionTimeoutMS: 10000,
            }).asPromise();

            const adminDb = adminConn.getClient().db().admin();
            const dbList = await adminDb.listDatabases();
            const tenantDbs = dbList.databases
                .map((d) => d.name)
                .filter((n) => /^talio_company_/i.test(n));

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

            await adminConn.close();
            stats.databases = tenantDbs.length;
            log(`Discovered ${tenantDbs.length} tenant DBs by name pattern`);

            for (const dbName of tenantDbs) {
                await migrateTenantDatabase(fallbackUri, dbName);
            }
        }

        log('────────────────────────────────────────────');
        log(`Summary:`, stats);
        log('────────────────────────────────────────────');
        if (DRY_RUN) {
            log('Dry run complete. Re-run with DRY_RUN=false to apply.');
        }
    } catch (err) {
        log(`Fatal: ${err.message}`);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

main();
