/**
 * Script: Reactivate All Users
 * 
 * Connects to all active tenants and marks all users as active.
 * Clears suspension fields (suspensionReason, suspendedAt).
 * 
 * Usage: node scripts/reactivate-users.js
 */

const mongoose = require('mongoose')
require('dotenv').config()

const MONGODB_URI = process.env.MONGODB_URI

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not defined in .env')
  process.exit(1)
}

function getDatabaseUri(databaseName) {
  const match = MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?([^?]*)?(\?.*)?$/)
  if (!match) throw new Error('Invalid MONGODB_URI format')
  const baseUri = match[1]
  const queryString = match[3] || ''
  return `${baseUri}/${databaseName}${queryString}`
}

async function run() {
  console.log('🔗 Connecting to superadmin database...')

  const superadminConn = await mongoose.createConnection(getDatabaseUri('talio_superadmin'), {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 10000,
  }).asPromise()

  console.log('✅ Connected to superadmin DB')

  // Get all active tenants
  const TenantCompanySchema = new mongoose.Schema({}, { strict: false })
  const TenantCompany = superadminConn.model('TenantCompany', TenantCompanySchema, 'tenantcompanies')

  const tenants = await TenantCompany.find({
    isActive: true,
    serviceStatus: { $in: ['active', 'trial'] },
    isSetupComplete: true,
  }).lean()

  console.log(`📋 Found ${tenants.length} active tenant(s)\n`)

  let totalUpdated = 0

  for (const tenant of tenants) {
    const dbName = tenant.databaseName || `talio_company_${tenant.slug}`
    console.log(`\n🏢 Processing tenant: ${tenant.name} (${dbName})`)

    const tenantConn = await mongoose.createConnection(getDatabaseUri(dbName), {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 10000,
    }).asPromise()

    const UserSchema = new mongoose.Schema({}, { strict: false })
    const User = tenantConn.model('User', UserSchema, 'users')

    // Find all inactive users
    const inactiveUsers = await User.find({ isActive: false }).select('email role suspensionReason').lean()
    console.log(`   Found ${inactiveUsers.length} inactive user(s)`)

    if (inactiveUsers.length > 0) {
      // Log who we're reactivating
      for (const u of inactiveUsers) {
        console.log(`   → Reactivating: ${u.email} (${u.role}) - reason: ${u.suspensionReason || 'none'}`)
      }

      // Reactivate all
      const result = await User.updateMany(
        { isActive: false },
        {
          $set: { isActive: true },
          $unset: { suspensionReason: '', suspendedAt: '' }
        }
      )

      console.log(`   ✅ Reactivated ${result.modifiedCount} user(s)`)
      totalUpdated += result.modifiedCount
    }

    await tenantConn.close()
  }

  console.log(`\n🎉 Done! Reactivated ${totalUpdated} user(s) across ${tenants.length} tenant(s)`)

  await superadminConn.close()
  process.exit(0)
}

run().catch(err => {
  console.error('❌ Script failed:', err)
  process.exit(1)
})
