/**
 * Migration Script: Organizational Hierarchy Upgrade
 * 
 * PURPOSE:
 * Creates "General" teams per department, moves existing employees into them,
 * initializes new User/Department fields (isDepartmentManager, teamLeaderOf, etc.),
 * and ensures backward compatibility with existing department head data.
 * 
 * SAFETY FEATURES:
 * - Dry-run mode by default (set DRY_RUN=false to execute)
 * - Idempotent: can be safely re-run (skips already-created teams)
 * - Full logging of every operation
 * - Batched processing to avoid memory pressure
 * - Rollback-safe: no destructive operations
 * 
 * USAGE:
 *   # Dry run (preview changes):
 *   node scripts/migrate-org-hierarchy.js
 * 
 *   # Execute migration:
 *   DRY_RUN=false node scripts/migrate-org-hierarchy.js
 * 
 * PREREQUISITES:
 *   - MONGODB_URI must point to the correct database
 *   - SUPERADMIN_DB_URI for tenant discovery (multi-tenant setup)
 * 
 * WHAT THIS SCRIPT DOES:
 * 1. For each active department, creates a "General" team (teamCode: dept-code-general)
 * 2. Adds all department employees as members of the General team
 * 3. Sets Department.teams to include the General team
 * 4. Initializes User fields: isDepartmentManager=false, departmentManagerOf=[], teamLeaderOf=[], teamMemberOf=[]
 * 5. Sets User.teamMemberOf for employees based on their department's General team
 * 6. Preserves all existing isDepartmentHead / headOfDepartments data
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

// ─── Configuration ──────────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN !== 'false';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 100;

// ─── Logging ────────────────────────────────────────────────────────────────

const stats = {
    totalDatabases: 0,
    totalDepartments: 0,
    teamsCreated: 0,
    teamsAlreadyExist: 0,
    membersAssigned: 0,
    usersInitialized: 0,
    usersAlreadyInitialized: 0,
    departmentsUpdated: 0,
    totalErrors: 0,
    errors: [],
};

function log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [ORG-HIERARCHY-MIGRATION] [${level.toUpperCase()}]`;
    if (level === 'error') {
        console.error(`${prefix} ${message}`, Object.keys(data).length ? data : '');
    } else {
        console.log(`${prefix} ${message}`, Object.keys(data).length ? data : '');
    }
}

// ─── Migration Logic ────────────────────────────────────────────────────────

async function migrateTenantDatabase(uri, dbName) {
    log('info', `Processing database: ${dbName}`);

    let connection;
    try {
        connection = await mongoose.createConnection(uri, {
            dbName: dbName,
            maxPoolSize: 5,
            serverSelectionTimeoutMS: 10000,
        }).asPromise();

        const deptCollection = connection.collection('departments');
        const employeeCollection = connection.collection('employees');
        const userCollection = connection.collection('users');
        const teamCollection = connection.collection('teams');

        // ── Step 1: Get all active departments ─────────────────────────────

        const departments = await deptCollection.find({ isActive: { $ne: false } }).toArray();
        log('info', `  Found ${departments.length} active departments in ${dbName}`);
        stats.totalDepartments += departments.length;

        for (const dept of departments) {
            const deptCode = dept.code || dept.name?.toLowerCase().replace(/\s+/g, '-');
            const teamCode = `${deptCode}-general`;
            const deptId = dept._id;

            // ── Step 2: Check if General team already exists ───────────────

            const existingTeam = await teamCollection.findOne({ teamCode, department: deptId });

            let teamId;
            if (existingTeam) {
                log('info', `  Team "${teamCode}" already exists for dept "${dept.name}" - skipping creation`);
                stats.teamsAlreadyExist++;
                teamId = existingTeam._id;
            } else {
                // Create the General team
                if (DRY_RUN) {
                    log('info', `  [DRY RUN] Would create team "${teamCode}" for dept "${dept.name}"`);
                    stats.teamsCreated++;
                    teamId = new mongoose.Types.ObjectId(); // placeholder
                } else {
                    const teamDoc = {
                        teamName: 'General',
                        teamCode,
                        description: `Default team for ${dept.name} department`,
                        department: deptId,
                        teamLeaders: [],
                        members: [],
                        createdBy: dept.head || null,
                        isActive: true,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };
                    const result = await teamCollection.insertOne(teamDoc);
                    teamId = result.insertedId;
                    stats.teamsCreated++;
                    log('info', `  Created team "${teamCode}" (${teamId}) for dept "${dept.name}"`);
                }
            }

            // ── Step 3: Find all employees in this department ──────────────

            const deptEmployees = await employeeCollection.find({
                $or: [
                    { department: deptId },
                    { departments: deptId }
                ],
                isActive: { $ne: false }
            }).project({ _id: 1 }).toArray();

            const employeeIds = deptEmployees.map(e => e._id);
            log('info', `  Dept "${dept.name}": ${employeeIds.length} employees`);

            // ── Step 4: Add employees as members of the General team ───────

            if (employeeIds.length > 0 && !existingTeam) {
                if (DRY_RUN) {
                    log('info', `  [DRY RUN] Would add ${employeeIds.length} members to team "${teamCode}"`);
                } else {
                    await teamCollection.updateOne(
                        { _id: teamId },
                        { $addToSet: { members: { $each: employeeIds } } }
                    );
                    log('info', `  Added ${employeeIds.length} members to team "${teamCode}"`);
                }
                stats.membersAssigned += employeeIds.length;
            } else if (existingTeam) {
                // For existing teams, add any employees not yet in the team
                const currentMembers = new Set((existingTeam.members || []).map(m => m.toString()));
                const newMembers = employeeIds.filter(id => !currentMembers.has(id.toString()));
                if (newMembers.length > 0) {
                    if (DRY_RUN) {
                        log('info', `  [DRY RUN] Would add ${newMembers.length} new members to existing team "${teamCode}"`);
                    } else {
                        await teamCollection.updateOne(
                            { _id: teamId },
                            { $addToSet: { members: { $each: newMembers } } }
                        );
                        log('info', `  Added ${newMembers.length} new members to existing team "${teamCode}"`);
                    }
                    stats.membersAssigned += newMembers.length;
                }
            }

            // ── Step 5: Update Department.teams to include the General team ─

            const deptTeams = dept.teams || [];
            const hasTeam = deptTeams.some(t => t.toString() === teamId.toString());
            if (!hasTeam) {
                if (DRY_RUN) {
                    log('info', `  [DRY RUN] Would add team "${teamCode}" to dept "${dept.name}".teams`);
                } else {
                    await deptCollection.updateOne(
                        { _id: deptId },
                        { $addToSet: { teams: teamId } }
                    );
                    log('info', `  Added team "${teamCode}" to dept "${dept.name}".teams`);
                }
                stats.departmentsUpdated++;
            }

            // ── Step 6: Update User.teamMemberOf for each employee ─────────

            for (const empId of employeeIds) {
                const userDoc = await userCollection.findOne({ employeeId: empId });
                if (!userDoc) continue;

                const teamMemberOf = userDoc.teamMemberOf || [];
                const alreadyMember = teamMemberOf.some(t => t.toString() === teamId.toString());

                if (!alreadyMember) {
                    if (DRY_RUN) {
                        log('info', `  [DRY RUN] Would add team "${teamCode}" to user ${userDoc.email}.teamMemberOf`);
                    } else {
                        await userCollection.updateOne(
                            { _id: userDoc._id },
                            { $addToSet: { teamMemberOf: teamId } }
                        );
                    }
                }
            }
        }

        // ── Step 7: Initialize new fields on all User documents ──────────

        // Set isDepartmentManager=false where not already set
        const usersNeedingInit = await userCollection.countDocuments({
            isDepartmentManager: { $exists: false }
        });

        if (usersNeedingInit > 0) {
            if (DRY_RUN) {
                log('info', `  [DRY RUN] Would initialize ${usersNeedingInit} users with new hierarchy fields`);
            } else {
                await userCollection.updateMany(
                    { isDepartmentManager: { $exists: false } },
                    {
                        $set: {
                            isDepartmentManager: false,
                            departmentManagerOf: [],
                        }
                    }
                );
                log('info', `  Initialized isDepartmentManager on ${usersNeedingInit} users`);
            }
            stats.usersInitialized += usersNeedingInit;
        }

        // Initialize teamLeaderOf where not set
        const usersNeedingTeamLeader = await userCollection.countDocuments({
            teamLeaderOf: { $exists: false }
        });
        if (usersNeedingTeamLeader > 0) {
            if (DRY_RUN) {
                log('info', `  [DRY RUN] Would initialize ${usersNeedingTeamLeader} users with teamLeaderOf=[]`);
            } else {
                await userCollection.updateMany(
                    { teamLeaderOf: { $exists: false } },
                    { $set: { teamLeaderOf: [] } }
                );
            }
        }

        // Initialize teamMemberOf where not set (shouldn't happen after step 6, but safety net)
        const usersNeedingTeamMember = await userCollection.countDocuments({
            teamMemberOf: { $exists: false }
        });
        if (usersNeedingTeamMember > 0) {
            if (DRY_RUN) {
                log('info', `  [DRY RUN] Would initialize ${usersNeedingTeamMember} users with teamMemberOf=[]`);
            } else {
                await userCollection.updateMany(
                    { teamMemberOf: { $exists: false } },
                    { $set: { teamMemberOf: [] } }
                );
            }
        }

        // ── Step 8: Initialize Department.departmentManagers where missing ─

        const deptsNeedingInit = await deptCollection.countDocuments({
            departmentManagers: { $exists: false }
        });
        if (deptsNeedingInit > 0) {
            if (DRY_RUN) {
                log('info', `  [DRY RUN] Would initialize ${deptsNeedingInit} departments with departmentManagers=[]`);
            } else {
                await deptCollection.updateMany(
                    { departmentManagers: { $exists: false } },
                    { $set: { departmentManagers: [], departmentManager: null } }
                );
            }
        }

        log('info', `  Completed database: ${dbName}`);
    } catch (error) {
        log('error', `Error processing ${dbName}: ${error.message}`);
        stats.totalErrors++;
        stats.errors.push({ database: dbName, error: error.message });
    } finally {
        if (connection) {
            await connection.close();
        }
    }
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

async function main() {
    log('info', '═══════════════════════════════════════════════════════════');
    log('info', '  Organizational Hierarchy Migration');
    log('info', `  Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : '⚠️  LIVE - changes will be written!'}`);
    log('info', '═══════════════════════════════════════════════════════════');

    const mongoUri = process.env.MONGODB_URI;
    const superadminUri = process.env.SUPERADMIN_DB_URI;

    if (!mongoUri && !superadminUri) {
        log('error', 'MONGODB_URI or SUPERADMIN_DB_URI environment variable is required');
        process.exit(1);
    }

    try {
        // Discover tenants from superadmin database
        if (superadminUri) {
            const superConn = await mongoose.createConnection(superadminUri, {
                maxPoolSize: 3,
                serverSelectionTimeoutMS: 10000,
            }).asPromise();

            // Find all active tenants
            const tenantsCollection = superConn.collection('tenants');
            const tenants = await tenantsCollection.find({
                isActive: { $ne: false }
            }).project({ databaseName: 1, companyName: 1 }).toArray();

            log('info', `Found ${tenants.length} active tenants`);
            stats.totalDatabases = tenants.length;

            for (const tenant of tenants) {
                const tenantUri = mongoUri || superadminUri.replace(/\/[^/?]+(\?|$)/, `/${tenant.databaseName}$1`);
                await migrateTenantDatabase(tenantUri, tenant.databaseName);
            }

            await superConn.close();
        } else {
            // Single database mode
            const dbName = mongoUri.match(/\/([^/?]+)(\?|$)/)?.[1] || 'talio';
            stats.totalDatabases = 1;
            await migrateTenantDatabase(mongoUri, dbName);
        }
    } catch (error) {
        log('error', `Fatal error: ${error.message}`);
        stats.totalErrors++;
    }

    // ── Print Summary ───────────────────────────────────────────────────────

    log('info', '');
    log('info', '═══════════════════════════════════════════════════════════');
    log('info', '  Migration Summary');
    log('info', '═══════════════════════════════════════════════════════════');
    log('info', `  Databases processed:     ${stats.totalDatabases}`);
    log('info', `  Departments found:       ${stats.totalDepartments}`);
    log('info', `  Teams created:           ${stats.teamsCreated}`);
    log('info', `  Teams already existed:   ${stats.teamsAlreadyExist}`);
    log('info', `  Members assigned:        ${stats.membersAssigned}`);
    log('info', `  Users initialized:       ${stats.usersInitialized}`);
    log('info', `  Departments updated:     ${stats.departmentsUpdated}`);
    log('info', `  Errors:                  ${stats.totalErrors}`);
    if (stats.errors.length > 0) {
        log('error', '  Error details:', stats.errors);
    }
    if (DRY_RUN) {
        log('info', '');
        log('info', '  ⚠️  This was a DRY RUN. No changes were made.');
        log('info', '  To execute: DRY_RUN=false node scripts/migrate-org-hierarchy.js');
    }
    log('info', '═══════════════════════════════════════════════════════════');

    await mongoose.disconnect();
    process.exit(stats.totalErrors > 0 ? 1 : 0);
}

main();
