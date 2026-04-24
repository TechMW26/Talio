/**
 * Sync FY 26-27 leave balances from the two HR Excel sheets into the
 * `talio_company_mushroom_world_group` tenant DB.
 *
 * Sheets (header in row 1):
 *   E.ID | Email ID | Name | Designation | DOJ | Probation Status |
 *   Eligibility for EL | Total Months | EL ALLOTED | SL ALLOTED | CL ALLOTED |
 *   Bereavement Leave | Wedding Leave | Paternity Leave | Maternity Leave
 *
 * Numeric columns (EL/SL/CL) are written to LeaveBalance for year 2026.
 * "As Per Company Policy" string columns are skipped (no numeric override).
 *
 * Usage:
 *   node tmp/sync_leave_balances_fy26.js          # dry-run (default)
 *   node tmp/sync_leave_balances_fy26.js --apply  # write to DB
 */
require('dotenv').config()
const path = require('path')
const mongoose = require('mongoose')
const openpyxl = null // not used; we'll parse via xlsx loaded by python pre-step? Simpler: use 'xlsx' npm

let XLSX
try { XLSX = require('xlsx') } catch { console.error('npm i xlsx'); process.exit(1) }

const APPLY = process.argv.includes('--apply')
const YEAR = 2026 // FY 26-27 starts April 2026

const FILES = [
  { path: 'DTPS Leave Balance Sheet FY 26-27.xlsx', unit: 'DTPS' },
  { path: 'MWU LEAVE BALANCE SHEET -FY 26-27.xlsx', unit: 'MWU' },
]

function readSheet(file) {
  const wb = XLSX.readFile(file)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true })
  return rows
}

function normEmail(e) {
  if (!e) return ''
  return String(e).split(/\s|\n/).map(s => s.trim().toLowerCase()).filter(Boolean)[0] || ''
}

function normName(n) {
  return (n || '').toString().toLowerCase().replace(/\s+/g, ' ').trim()
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  const tdb = mongoose.connection.useDb('talio_company_mushroom_world_group')
  const Employee = tdb.model('Employee_p', new mongoose.Schema({}, { strict: false }), 'employees')
  const LeaveType = tdb.model('LeaveType_p', new mongoose.Schema({}, { strict: false }), 'leavetypes')
  const LeaveBalance = tdb.model('LeaveBalance_p', new mongoose.Schema({}, { strict: false }), 'leavebalances')

  const types = await LeaveType.find({}).lean()
  const typeByCode = {}
  for (const t of types) typeByCode[(t.code || '').toUpperCase()] = t
  for (const code of ['EL', 'SL', 'CL']) {
    if (!typeByCode[code]) {
      console.error(`Missing LeaveType with code=${code} in tenant DB. Aborting.`)
      process.exit(1)
    }
  }

  const employees = await Employee.find({}, { email: 1, employeeId: 1, firstName: 1, lastName: 1, name: 1 }).lean()
  const empByEmail = new Map()
  const empByEmpId = new Map()
  const empByName = new Map()
  for (const e of employees) {
    if (e.email) empByEmail.set(String(e.email).toLowerCase(), e)
    if (e.employeeId) empByEmpId.set(String(e.employeeId).toUpperCase(), e)
    const fn = `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.name || ''
    if (fn) empByName.set(normName(fn), e)
  }

  const summary = { matched: 0, unmatched: [], updates: [], skipped: 0 }

  for (const f of FILES) {
    const rows = readSheet(f.path)
    console.log(`\n>>> ${f.unit} (${f.path}) — rows: ${rows.length}`)
    for (const r of rows) {
      const eid = (r['E.ID'] || '').toString().trim().toUpperCase()
      const email = normEmail(r['Email ID'] || r['E Mail ID'])
      const name = (r['Name'] || '').toString().trim()
      const el = Number(r['EL ALLOTED'])
      const sl = Number(r['SL ALLOTED'])
      const cl = Number(r['CL ALLOTED'])
      if (!Number.isFinite(el) && !Number.isFinite(sl) && !Number.isFinite(cl)) continue

      // Match employee
      let emp = (email && empByEmail.get(email))
        || (eid && empByEmpId.get(eid))
        || (name && empByName.get(normName(name)))

      if (!emp) {
        summary.unmatched.push({ unit: f.unit, eid, email, name })
        continue
      }
      summary.matched++

      const desired = [
        { code: 'EL', value: el },
        { code: 'SL', value: sl },
        { code: 'CL', value: cl },
      ].filter(x => Number.isFinite(x.value))

      for (const d of desired) {
        const lt = typeByCode[d.code]
        const existing = await LeaveBalance.findOne({ employee: emp._id, leaveType: lt._id, year: YEAR }).lean()
        const usedDays = Number(existing?.usedDays ?? existing?.used ?? 0) || 0
        const pending = Number(existing?.pending ?? 0) || 0
        const carriedForward = Number(existing?.carriedForward ?? 0) || 0
        const totalDays = d.value
        const remainingDays = Math.max(0, totalDays + carriedForward - usedDays - pending)

        const update = {
          employee: emp._id,
          leaveType: lt._id,
          year: YEAR,
          totalDays,
          usedDays,
          remainingDays,
          // Mirror to schema-canonical fields too (strict:false)
          allocated: totalDays,
          used: usedDays,
          pending,
          balance: remainingDays,
          carriedForward,
        }

        const action = existing ? 'update' : 'insert'
        summary.updates.push({
          unit: f.unit,
          empId: emp.employeeId || String(emp._id),
          email: emp.email,
          code: d.code,
          before: existing ? { totalDays: existing.totalDays, remainingDays: existing.remainingDays } : null,
          after: { totalDays, remainingDays },
          action,
        })

        if (APPLY) {
          await LeaveBalance.updateOne(
            { employee: emp._id, leaveType: lt._id, year: YEAR },
            { $set: update },
            { upsert: true }
          )
        }
      }
    }
  }

  console.log('\n=== SUMMARY ===')
  console.log('Matched employees:', summary.matched)
  console.log('Updates planned:', summary.updates.length)
  console.log('Unmatched rows:', summary.unmatched.length)
  if (summary.unmatched.length) {
    console.log('--- Unmatched (need manual review) ---')
    for (const u of summary.unmatched) console.log(`  [${u.unit}] eid=${u.eid} email=${u.email} name=${u.name}`)
  }
  // Show first 15 changes
  console.log('\n--- First 15 changes ---')
  for (const u of summary.updates.slice(0, 15)) {
    console.log(`  [${u.unit}] ${u.empId} <${u.email}> ${u.code}: ${JSON.stringify(u.before)} -> ${JSON.stringify(u.after)} (${u.action})`)
  }
  if (!APPLY) console.log('\n(DRY RUN — re-run with --apply to persist.)')
  await mongoose.disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
