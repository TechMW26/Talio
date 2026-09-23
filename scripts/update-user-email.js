/**
 * Script: Update a user's email across the multitenant system.
 *
 * Updates the login routing record (talio_superadmin.usertenantmappings) and,
 * inside the owning tenant database, the `users` and `employees` collections.
 *
 * Usage:
 *   OLD_EMAIL=sahi.sahu@mushroomworldgroup.com \
 *   NEW_EMAIL=sahil.sahu@mushroomworldgroup.com \
 *   node scripts/update-user-email.js
 */

const mongoose = require('mongoose')
require('dotenv').config()

const OLD_EMAIL = (process.env.OLD_EMAIL || 'sahi.sahu@mushroomworldgroup.com').toLowerCase()
const NEW_EMAIL = (process.env.NEW_EMAIL || 'sahil.sahu@mushroomworldgroup.com').toLowerCase()

const MONGODB_URI = process.env.MONGODB_URI

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not defined in .env')
  process.exit(1)
}

if (!OLD_EMAIL || !NEW_EMAIL || OLD_EMAIL === NEW_EMAIL) {
  console.error('❌ Provide distinct OLD_EMAIL and NEW_EMAIL')
  process.exit(1)
}

function getDatabaseUri(databaseName) {
  const match = MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?([^?]*)?(\?.*)?$/)
  if (!match) throw new Error('Invalid MONGODB_URI format')
  const baseUri = match[1]
  const queryString = match[3] || ''
  return `${baseUri}/${databaseName}${queryString}`
}

const CONN_OPTIONS = { maxPoolSize: 5, serverSelectionTimeoutMS: 15000 }

async function run() {
  console.log(`🔁 Updating email ${OLD_EMAIL} → ${NEW_EMAIL}\n`)

  const superadminConn = await mongoose.createConnection(getDatabaseUri('talio_superadmin'), CONN_OPTIONS).asPromise()
  console.log('✅ Connected to superadmin DB')

  const Mapping = superadminConn.model('UserTenantMapping', new mongoose.Schema({}, { strict: false }), 'usertenantmappings')

  // 1) Superadmin login routing record
  const mapping = await Mapping.findOne({ email: OLD_EMAIL }).lean()
  if (mapping) {
    const collision = await Mapping.findOne({ email: NEW_EMAIL }).lean()
    if (collision) {
      console.error(`❌ NEW_EMAIL already exists in usertenantmappings for tenant ${collision.databaseName}`)
    } else {
      const res = await Mapping.updateOne({ email: OLD_EMAIL }, { $set: { email: NEW_EMAIL } })
      console.log(`✅ usertenantmappings: updated ${res.modifiedCount} record(s) (${mapping.databaseName})`)
    }
  } else {
    console.log('⚠️  No usertenantmappings record found for old email')
  }

  // 2) Tenant databases (users + employees)
  const TenantCompany = superadminConn.model('TenantCompany', new mongoose.Schema({}, { strict: false }), 'tenantcompanies')
  const tenants = await TenantCompany.find({
    isActive: true,
    serviceStatus: { $in: ['active', 'trial'] },
    isSetupComplete: true,
  }).lean()

  console.log(`\n📋 Found ${tenants.length} active tenant(s)`)

  let totalUsersUpdated = 0
  let totalEmployeesUpdated = 0

  for (const tenant of tenants) {
    const dbName = tenant.databaseName || `talio_company_${tenant.slug}`
    const tenantConn = await mongoose.createConnection(getDatabaseUri(dbName), CONN_OPTIONS).asPromise()

    const User = tenantConn.model('User', new mongoose.Schema({}, { strict: false }), 'users')
    const Employee = tenantConn.model('Employee', new mongoose.Schema({}, { strict: false }), 'employees')

    // Guard against unique-index collisions before writing
    const userCollision = await User.findOne({ email: NEW_EMAIL, _id: { $ne: null } }).lean()
    const empCollision = await Employee.findOne({ email: NEW_EMAIL }).lean()

    const oldUser = await User.findOne({ email: OLD_EMAIL }).lean()
    const oldEmployee = await Employee.findOne({ email: OLD_EMAIL }).lean()

    if (!oldUser && !oldEmployee) {
      await tenantConn.close()
      continue
    }

    console.log(`\n🏢 Tenant: ${tenant.name} (${dbName})`)

    if (oldUser) {
      if (userCollision && String(userCollision._id) !== String(oldUser._id)) {
        console.error(`   ❌ users: NEW_EMAIL already used by another record (_id ${userCollision._id}) — skipped`)
      } else {
        const res = await User.updateOne({ _id: oldUser._id }, { $set: { email: NEW_EMAIL } })
        console.log(`   ✅ users: updated ${res.modifiedCount} record(s) (was ${oldUser.email})`)
        totalUsersUpdated += res.modifiedCount
      }
    }

    if (oldEmployee) {
      if (empCollision && String(empCollision._id) !== String(oldEmployee._id)) {
        console.error(`   ❌ employees: NEW_EMAIL already used by another record (_id ${empCollision._id}) — skipped`)
      } else {
        const res = await Employee.updateOne({ _id: oldEmployee._id }, { $set: { email: NEW_EMAIL } })
        console.log(`   ✅ employees: updated ${res.modifiedCount} record(s) (was ${oldEmployee.email})`)
        totalEmployeesUpdated += res.modifiedCount
      }
    }

    await tenantConn.close()
  }

  console.log(`\n🎉 Done! users: ${totalUsersUpdated}, employees: ${totalEmployeesUpdated}`)
  await superadminConn.close()
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Script failed:', err)
  process.exit(1)
})
