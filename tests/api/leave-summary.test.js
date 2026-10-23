import { summarizeLeaveBalanceRecords } from '@/lib/leaveBalances.server'

const employeeId = '111111111111111111111111'
const type = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', code: 'CL', name: 'Casual Leave', isActive: true }

test('computes available from approved and pending requests only', () => {
  const [balance] = summarizeLeaveBalanceRecords({
    employeeId,
    year: 2026,
    types: [type],
    balances: [{ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', employee: employeeId, leaveType: type._id, year: 2026, totalDays: 10, carriedForward: 2 }],
    requests: [
      { leaveType: 'CL', status: 'approved', numberOfDays: 2 },
      { leaveType: type._id, status: 'pending', days: 3 },
      { leaveType: 'CL', status: 'rejected', numberOfDays: 5 },
      { leaveType: 'CL', status: 'cancelled', numberOfDays: 4 },
    ],
  })

  expect(balance).toMatchObject({
    employee: employeeId,
    leaveType: { _id: type._id, code: 'CL', name: 'Casual Leave' },
    total: 10,
    carriedForward: 2,
    used: 2,
    pending: 3,
    available: 7,
  })
})

test('never reports a negative available balance', () => {
  const [balance] = summarizeLeaveBalanceRecords({
    employeeId,
    year: 2026,
    types: [type],
    balances: [{ leaveType: type._id, year: 2026, totalDays: 2 }],
    requests: [{ leaveType: 'CL', status: 'approved', numberOfDays: 5 }],
  })

  expect(balance.available).toBe(0)
})
