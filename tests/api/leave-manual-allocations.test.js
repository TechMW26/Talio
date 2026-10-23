const { ensureEmployeeLeaveBalances } = require('@/lib/leaveAllocation.server')
const { computeLeaveBalanceEntries } = require('@/lib/leaveBalances.server')
const { workflowStore } = require('../helpers/firestoreWorkflowStore')

const employeeId = '111111111111111111111111'
const ids = {
  CL: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  SL: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  EL: 'cccccccccccccccccccccccc',
  WL: 'dddddddddddddddddddddddd',
  BL: 'eeeeeeeeeeeeeeeeeeeeeeee',
  LWP: 'ffffffffffffffffffffffff',
}
const leaveTypes = [
  { _id: ids.CL, code: 'CL', name: 'Casual Leave', isActive: true, maxDaysPerYear: 7 },
  { _id: ids.SL, code: 'SL', name: 'Sick Leave', isActive: true, maxDaysPerYear: 5 },
  { _id: ids.EL, code: 'EL', name: 'Earned Leave', isActive: true, maxDaysPerYear: 18 },
  { _id: ids.WL, code: 'WL', name: 'Wedding Leave', isActive: true, maxDaysPerYear: 7 },
  { _id: ids.BL, code: 'BL', name: 'Bereavement Leave', isActive: true, maxDaysPerYear: 10 },
  { _id: ids.LWP, code: 'LWP', name: 'Leave Without Pay', isActive: true, maxDaysPerYear: 0 },
]

test('a new joiner is only granted the accruing leave types', async () => {
  const database = workflowStore({
    employees: [{ _id: employeeId, status: 'active', dateOfJoining: '2026-09-01' }],
    leavetypes: leaveTypes,
  })

  const result = await ensureEmployeeLeaveBalances({ database, employeeId, year: 2026 })
  const created = (await database.list('leavebalances')).records.map(record => record.leaveType).sort()

  expect(created).toEqual([ids.CL, ids.EL, ids.SL].sort())
  expect(result.allocated).toBe(3)
})

test('manual WL/BL only appear after an explicit HR allocation', () => {
  const employee = { _id: employeeId, dateOfJoining: '2026-09-01' }
  const codesFor = balances => computeLeaveBalanceEntries({ employeeId, employee, types: leaveTypes, balances, requests: [], year: 2026, asOf: '2026-10-23' })
    .map(entry => entry.leaveType.code)

  const seeded = [{ _id: 'abababababababababababab', employee: employeeId, leaveType: ids.WL, year: 2026, totalDays: 2.34, allocated: 2.34, remainingDays: 2.34 }]
  expect(codesFor(seeded)).not.toContain('WL')

  const granted = [{ _id: 'cdcdcdcdcdcdcdcdcdcdcdcd', employee: employeeId, leaveType: ids.WL, year: 2026, totalDays: 3, overrideDays: 3, source: 'manual' }]
  expect(codesFor(granted)).toContain('WL')
  expect(codesFor(granted)).not.toContain('BL')
})
