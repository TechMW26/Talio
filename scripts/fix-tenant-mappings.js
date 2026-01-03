/**
 * Fix Missing Tenant Mappings
 * 
 * This script registers all users in the tenant mapping who are missing.
 * Run this after bulk imports that occurred before the tenant mapping fix.
 * 
 * Usage:
 *   node scripts/fix-tenant-mappings.js --database=<database_name>
 *   
 * Example:
 *   node scripts/fix-tenant-mappings.js --database=mushroomworld_db
 *   
 * To fix ALL tenants:
 *   node scripts/fix-tenant-mappings.js --all
 */

const mongoose = require('mongoose')
require('dotenv').config()

// Parse command line arguments
const args = process.argv.slice(2)
const databaseArg = args.find(arg => arg.startsWith('--database='))
const fixAll = args.includes('--all')
const dryRun = args.includes('--dry-run')

const targetDatabase = databaseArg ? databaseArg.split('=')[1] : null

if (!targetDatabase && !fixAll) {
    console.log(`
Usage:
  node scripts/fix-tenant-mappings.js --database=<database_name>
  node scripts/fix-tenant-mappings.js --all
  
Options:
  --dry-run    Preview changes without making them
  
Example:
  node scripts/fix-tenant-mappings.js --database=mushroomworld_db
  node scripts/fix-tenant-mappings.js --all --dry-run
`)
    process.exit(1)
}

// SuperAdmin database connection
const SUPERADMIN_URI = process.env.MONGODB_BACKUP_URI || process.env.MONGODB_URI

async function connectSuperadminDB() {
    const conn = await mongoose.createConnection(SUPERADMIN_URI, {
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 10000,
    }).asPromise()
    console.log('✅ Connected to SuperAdmin database')
    return conn
}

async function getTenantConnection(databaseName) {
    // Parse the base URI to construct tenant URI
    const baseUri = process.env.MONGODB_URI

    // For MongoDB Atlas, the database name is part of the connection string
    // Replace the default database with the tenant database
    let tenantUri = baseUri

    // Handle different URI formats
    if (baseUri.includes('mongodb+srv://')) {
        // For SRV format, add database name after the host
        const parts = baseUri.split('?')
        const hostPart = parts[0].replace(/\/[^/]*$/, '') // Remove any existing database name
        tenantUri = `${hostPart}/${databaseName}?${parts[1] || 'retryWrites=true&w=majority'}`
    } else if (baseUri.includes('mongodb://')) {
        // For standard format
        const parts = baseUri.split('?')
        const hostPart = parts[0].replace(/\/[^/]*$/, '')
        tenantUri = `${hostPart}/${databaseName}?${parts[1] || ''}`
    }

    const conn = await mongoose.createConnection(tenantUri, {
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 10000,
    }).asPromise()

    return conn
}

// UserTenantMapping Schema
const UserTenantMappingSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    tenantCompanyId: { type: mongoose.Schema.Types.ObjectId, required: true },
    databaseName: { type: String, required: true, index: true },
    companyName: { type: String },
    companySlug: { type: String, index: true },
    role: { type: String, default: 'employee' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    loginCount: { type: Number, default: 0 },
}, { timestamps: true })

// TenantCompany Schema
const TenantCompanySchema = new mongoose.Schema({
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    databaseName: { type: String, required: true, unique: true },
    isActive: { type: Boolean, default: true },
}, { timestamps: true })

// User Schema (for tenant databases)
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true },
    role: { type: String },
    isActive: { type: Boolean, default: true },
})

async function fixTenantMappings() {
    console.log('='.repeat(60))
    console.log('Fix Missing Tenant Mappings')
    console.log('='.repeat(60))

    if (dryRun) {
        console.log('🔍 DRY RUN MODE - No changes will be made\n')
    }

    let superadminConn

    try {
        // Connect to superadmin database
        superadminConn = await connectSuperadminDB()

        const UserTenantMapping = superadminConn.model('UserTenantMapping', UserTenantMappingSchema)
        const TenantCompany = superadminConn.model('TenantCompany', TenantCompanySchema)

        // Get all tenant companies or specific one
        let companies
        if (fixAll) {
            companies = await TenantCompany.find({ isActive: true }).lean()
            console.log(`\n📋 Found ${companies.length} active tenant companies\n`)
        } else {
            const company = await TenantCompany.findOne({ databaseName: targetDatabase }).lean()
            if (!company) {
                console.error(`❌ No tenant company found with database: ${targetDatabase}`)
                process.exit(1)
            }
            companies = [company]
        }

        let totalFixed = 0
        let totalSkipped = 0
        let totalErrors = 0

        for (const company of companies) {
            console.log(`\n${'─'.repeat(50)}`)
            console.log(`📂 Processing: ${company.name} (${company.databaseName})`)
            console.log(`${'─'.repeat(50)}`)

            let tenantConn

            try {
                // Connect to tenant database
                tenantConn = await getTenantConnection(company.databaseName)
                const TenantUser = tenantConn.model('User', UserSchema)

                // Get all active users from tenant database
                const users = await TenantUser.find({ isActive: true }).select('email role').lean()
                console.log(`   Found ${users.length} active users in tenant database`)

                for (const user of users) {
                    if (!user.email) continue

                    const email = user.email.toLowerCase().trim()

                    // Check if mapping already exists
                    const existingMapping = await UserTenantMapping.findOne({ email }).lean()

                    if (existingMapping) {
                        // Check if mapping is for the same database
                        if (existingMapping.databaseName === company.databaseName) {
                            totalSkipped++
                            continue // Already mapped correctly
                        } else {
                            console.log(`   ⚠️  ${email} - mapped to different tenant: ${existingMapping.databaseName}`)
                            totalSkipped++
                            continue
                        }
                    }

                    // Need to create mapping
                    console.log(`   ✅ ${email} - ${dryRun ? 'WOULD CREATE' : 'CREATING'} mapping (role: ${user.role || 'employee'})`)

                    if (!dryRun) {
                        await UserTenantMapping.create({
                            email: email,
                            tenantCompanyId: company._id,
                            databaseName: company.databaseName,
                            companyName: company.name,
                            companySlug: company.slug,
                            role: user.role || 'employee',
                            isActive: true,
                        })
                    }

                    totalFixed++
                }

            } catch (tenantError) {
                console.error(`   ❌ Error processing ${company.name}:`, tenantError.message)
                totalErrors++
            } finally {
                if (tenantConn) {
                    await tenantConn.close()
                }
            }
        }

        console.log('\n' + '='.repeat(60))
        console.log('Summary')
        console.log('='.repeat(60))
        console.log(`✅ Mappings ${dryRun ? 'to create' : 'created'}: ${totalFixed}`)
        console.log(`⏭️  Already mapped (skipped): ${totalSkipped}`)
        console.log(`❌ Errors: ${totalErrors}`)

        if (dryRun && totalFixed > 0) {
            console.log(`\n💡 Run without --dry-run to create these mappings`)
        }

    } catch (error) {
        console.error('❌ Fatal error:', error.message)
        process.exit(1)
    } finally {
        if (superadminConn) {
            await superadminConn.close()
        }
        await mongoose.disconnect()
    }
}

fixTenantMappings().then(() => {
    console.log('\n✅ Done!')
    process.exit(0)
}).catch(err => {
    console.error('❌ Script failed:', err)
    process.exit(1)
})
