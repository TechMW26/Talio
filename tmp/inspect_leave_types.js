require('dotenv').config()
const mongoose = require('mongoose')

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  const tdb = mongoose.connection.useDb('talio_company_mushroom_world_group')
  const LeaveType = tdb.model('LeaveType_p', new mongoose.Schema({}, { strict: false }), 'leavetypes')
  const types = await LeaveType.find({}).lean()
  console.log('=== LeaveTypes ===')
  for (const t of types) {
    console.log(`- _id=${t._id} code=${t.code} name="${t.name}" daysPerYear=${t.daysPerYear} active=${t.isActive} gender=${t.applicableGender || ''}`)
  }

  const LeaveBalance = tdb.model('LeaveBalance_p', new mongoose.Schema({}, { strict: false }), 'leavebalances')
  const sample = await LeaveBalance.find({}).limit(5).lean()
  console.log('\n=== LeaveBalance sample ===')
  for (const b of sample) console.log(b)
  console.log('Total balances:', await LeaveBalance.countDocuments({}))

  // Distinct employeeIds field shape
  const Emp = tdb.model('Employee_p', new mongoose.Schema({}, { strict: false }), 'employees')
  const oneEmp = await Emp.findOne({ email: 'aviraj.sharma@mushroomworldgroup.com' }).lean()
  console.log('\n=== Aviraj employee doc keys ===')
  console.log(Object.keys(oneEmp || {}))
  console.log('employeeId field:', oneEmp?.employeeId, 'gender:', oneEmp?.gender)

  await mongoose.disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
