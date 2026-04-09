/**
 * Migration Script: RBAC System Initialization
 *
 * PURPOSE:
 * Seeds system roles into every tenant database and assigns each user a roleId
 * matching their existing User.role string. This bridges the legacy role system
 * to the new granular RBAC permission system.
 *
 * SAFETY FEATURES:
 * - Dry-run mode by default (set DRY_RUN=false to execute)
 * - Idempotent: can be safely re-run (skips already-assigned users/roles)
 * - Full logging of every operation
 * - Non-destructive: never removes existing data
 *
 * USAGE:
 *   # Dry run (preview changes):
 *   node scripts/rbac-migration.js
 *
 *   # Execute migration:
 *   DRY_RUN=false node scripts/rbac-migration.js
 *
 * PREREQUISITES:
 *   - MONGODB_URI must be set
 *   - SUPERADMIN_DB_URI for tenant discovery (multi-tenant setup)
 *
 * WHAT THIS SCRIPT DOES:
 * 1. Connects to superadmin DB to discover all tenant databases.
 * 2. For each tenant DB:
 *    a. Finds (or creates) Company document.
 *    b. Seeds 7 system roles from SYSTEM_ROLE_DEFINITIONS if missing.
 *    c. For each User without roleId, assigns the matching system Role.
 *    d. Clears permissionsCache for all modified users.
 */

import mongoose from 'mongoose'
import dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env') })
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

// Import RBAC definitions
import { SYSTEM_ROLE_DEFINITIONS } from '../lib/systemRoles.js'

// ─── Configuration ──────────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN !== 'false'
const MONGODB_URI = process.env.MONGODB_URI

// Build the superadmin DB URI: extract cluster base and append talio_superadmin
function buildSuperadminUri() {
    if (!MONGODB_URI) throw new Error('MONGODB_URI is not set')
    const match = MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?([^?]*)?(\?.*)?$/)
    if (!match) throw new Error('Invalid MONGODB_URI format')
    return `${match[1]}/talio_superadmin${match[3] || ''}`
}

// Build a tenant DB URI from the cluster base
function buildTenantUri(databaseName) {
    const match = MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?([^?]*)?(\?.*)?$/)
    if (!match) throw new Error('Invalid MONGODB_URI format')
    return `${match[1]}/${databaseName}${match[3] || ''}`
}

const SUPERADMIN_DB_URI = buildSuperadminUri()

// ─── Stats ──────────────────────────────────────────────────────────────────

const stats = {
    totalDatabases: 0,
    rolesCreated: 0,
    rolesExisted: 0,
    usersAssigned: 0,
    usersAlreadyAssigned: 0,
    errors: 0,
}

// ─── Logging ────────────────────────────────────────────────────────────────

function log(msg) {
    console.log(`[RBAC Migration] ${msg}`)
}
function warn(msg) {
    console.warn(`[RBAC Migration] ⚠️  ${msg}`)
}
function err(msg) {
    console.error(`[RBAC Migration] ❌ ${msg}`)
}

// ─── Schema Definitions (inline to avoid tenant model loader) ───────────────

const RoleSchema = new mongoose.Schema({
    name: { type: String, required: true },
    displayLabel: { type: String, required: true },
    description: { type: String, default: '' },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    permissions: { type: mongoose.Schema.Types.Mixed, required: true },
    isSystemRole: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
RoleSchema.index({ company: 1, name: 1 }, { unique: true })

const UserSchemaFields = {
    email: String,
    role: String,
    isActive: { type: Boolean, default: true },
    roleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', default: null },
    permissionsCache: { type: mongoose.Schema.Types.Mixed, default: null },
    cacheUpdatedAt: { type: Date, default: null },
}

const CompanySchemaFields = {
    name: String,
    code: String,
    isActive: { type: Boolean, default: true },
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    log(`--- RBAC Migration ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'} ---`)

    // Connect to superadmin DB
    const superConn = await mongoose.createConnection(SUPERADMIN_DB_URI).asPromise()
    log(`Connected to superadmin DB`)

    // Discover tenant databases from TenantCompany collection
    const TenantCompanySchema = new mongoose.Schema({
        name: String,
        slug: String,
        databaseName: String,
        isActive: { type: Boolean, default: true },
    })
    const TenantCompany = superConn.model('TenantCompany', TenantCompanySchema, 'tenantcompanies')
    const tenants = await TenantCompany.find({ isActive: true }).lean()
    log(`Found ${tenants.length} active tenant(s)`)

    for (const tenant of tenants) {
        log(`\n--- Processing tenant: ${tenant.name} (${tenant.databaseName}) ---`)
        stats.totalDatabases++

        let tenantConn
        try {
            // Build URI for tenant DB
            const tenantUri = buildTenantUri(tenant.databaseName)
            tenantConn = await mongoose.createConnection(tenantUri).asPromise()

            const Role = tenantConn.model('Role', RoleSchema, 'roles')
            const User = tenantConn.model('User', new mongoose.Schema(UserSchemaFields), 'users')
            const Company = tenantConn.model('Company', new mongoose.Schema(CompanySchemaFields), 'companies')

            // Find company
            const company = await Company.findOne({ isActive: true }).lean()
            if (!company) {
                warn(`No active company found for tenant ${tenant.databaseName}, skipping`)
                continue
            }

            // Seed system roles
            const roleMap = {} // name -> role doc
            for (const [key, def] of Object.entries(SYSTEM_ROLE_DEFINITIONS)) {
                const existing = await Role.findOne({
                    company: company._id,
                    name: def.name,
                    isSystemRole: true,
                }).lean()

                if (existing) {
                    // Update permissions on existing system roles (in case definitions changed)
                    const freshPermissions = def.buildPermissions()
                    if (DRY_RUN) {
                        log(`  [DRY RUN] Would refresh permissions for system role "${def.name}"`)
                    } else {
                        await Role.updateOne(
                            { _id: existing._id },
                            { $set: { permissions: freshPermissions, displayLabel: def.displayLabel, description: def.description } }
                        )
                        log(`  Refreshed permissions for system role "${def.name}"`)
                    }
                    roleMap[def.name] = existing
                    stats.rolesExisted++
                } else {
                    if (DRY_RUN) {
                        log(`  [DRY RUN] Would create system role "${def.name}"`)
                        roleMap[def.name] = { _id: 'dry-run', name: def.name }
                    } else {
                        const permissions = def.buildPermissions()
                        const created = await Role.create({
                            name: def.name,
                            displayLabel: def.displayLabel,
                            description: def.description,
                            company: company._id,
                            permissions,
                            isSystemRole: true,
                        })
                        roleMap[def.name] = created.toObject()
                        log(`  Created system role "${def.name}"`)
                    }
                    stats.rolesCreated++
                }
            }

            // Invalidate all users' permissionsCache so they pick up refreshed role permissions
            if (!DRY_RUN) {
                const invalidated = await User.updateMany(
                    { permissionsCache: { $ne: null } },
                    { $set: { permissionsCache: null, cacheUpdatedAt: null } }
                )
                if (invalidated.modifiedCount > 0) {
                    log(`  Invalidated permissionsCache for ${invalidated.modifiedCount} user(s)`)
                }
            }

            // Assign roleId to users without one
            const usersWithoutRole = await User.find({
                roleId: null,
                isActive: true,
            }).lean()

            log(`  Found ${usersWithoutRole.length} user(s) without roleId`)

            for (const u of usersWithoutRole) {
                const matchingRole = roleMap[u.role]
                if (!matchingRole) {
                    warn(`  No system role for user ${u.email} with role "${u.role}"`)
                    continue
                }

                if (DRY_RUN) {
                    log(`  [DRY RUN] Would assign role "${u.role}" to ${u.email}`)
                } else {
                    await User.updateOne(
                        { _id: u._id },
                        {
                            $set: {
                                roleId: matchingRole._id,
                                permissionsCache: null,
                                cacheUpdatedAt: null,
                            },
                        }
                    )
                    log(`  Assigned role "${u.role}" to ${u.email}`)
                }
                stats.usersAssigned++
            }

            // Count already-assigned users
            const alreadyAssigned = await User.countDocuments({
                roleId: { $ne: null },
                isActive: true,
            })
            stats.usersAlreadyAssigned += alreadyAssigned
            if (alreadyAssigned > 0) {
                log(`  ${alreadyAssigned} user(s) already have roleId assigned`)
            }
        } catch (error) {
            err(`Error processing tenant ${tenant.databaseName}: ${error.message}`)
            stats.errors++
        } finally {
            if (tenantConn) {
                await tenantConn.close()
            }
        }
    }

    await superConn.close()

    // Print summary
    log(`\n--- Migration Summary ---`)
    log(`Dry Run: ${DRY_RUN}`)
    log(`Databases processed: ${stats.totalDatabases}`)
    log(`System roles created: ${stats.rolesCreated}`)
    log(`System roles already existed: ${stats.rolesExisted}`)
    log(`Users assigned roleId: ${stats.usersAssigned}`)
    log(`Users already assigned: ${stats.usersAlreadyAssigned}`)
    log(`Errors: ${stats.errors}`)

    if (DRY_RUN) {
        log(`\nThis was a dry run. Run with DRY_RUN=false to execute.`)
    }

    process.exit(stats.errors > 0 ? 1 : 0)
}

main().catch((e) => {
    err(`Fatal migration error: ${e.message}`)
    console.error(e)
    process.exit(1)
})
