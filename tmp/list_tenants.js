// Quick discovery: list tenant companies + sample employees to verify which DB maps to DTPS vs MWU
require('dotenv').config()
const mongoose = require('mongoose')

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI missing')
  await mongoose.connect(uri)
  console.log('Connected. Default DB:', mongoose.connection.name)

  const adminDb = mongoose.connection.useDb('talio_superadmin')
  const TenantCompany = adminDb.model('TenantCompany', new mongoose.Schema({}, { strict: false }), 'tenantcompanies')
  const tenants = await TenantCompany.find({}).lean()
  console.log('\n=== Tenant Companies ===')
  for (const t of tenants) {
    console.log(`- name="${t.name}" slug="${t.slug}" db="${t.databaseName}" active=${t.isActive}`)
  }

  // Sample probe per tenant DB: count employees and show 3 sample emails
  for (const t of tenants) {
    if (!t.databaseName) continue
    try {
      const tdb = mongoose.connection.useDb(t.databaseName)
      const Emp = tdb.model('Employee_p', new mongoose.Schema({}, { strict: false }), 'employees')
      const count = await Emp.countDocuments({})
      const sample = await Emp.find({}, { email: 1, employeeId: 1, firstName: 1, lastName: 1 }).limit(5).lean()
      console.log(`\n[${t.databaseName}] employees=${count}`)
      sample.forEach(e => console.log(`   ${e.employeeId || ''} ${e.firstName || ''} ${e.lastName || ''} <${e.email || ''}>`))
    } catch (err) {
      console.log(`[${t.databaseName}] error:`, err.message)
    }
  }

  await mongoose.disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
