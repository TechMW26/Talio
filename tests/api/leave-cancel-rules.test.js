import { canEmployeeCancelLeave } from '@/lib/leaveCancel'

describe('employee leave cancellation rule', () => {
  const now = new Date('2026-11-25T10:00:00+05:30')

  test('pending leave can always be cancelled', () => {
    expect(canEmployeeCancelLeave({ status: 'pending', startDate: '2026-11-20' }, now)).toBe(true)
    expect(canEmployeeCancelLeave({ status: 'pending', startDate: '2026-12-01' }, now)).toBe(true)
  })

  test('approved leave can be cancelled only before it starts (India date)', () => {
    expect(canEmployeeCancelLeave({ status: 'approved', startDate: '2026-11-26' }, now)).toBe(true)
    expect(canEmployeeCancelLeave({ status: 'approved', startDate: '2026-11-25' }, now)).toBe(false)
    expect(canEmployeeCancelLeave({ status: 'approved', startDate: '2026-11-10' }, now)).toBe(false)
    // 25 Nov 23:30 IST is still 25 Nov, so a leave starting 26 Nov can be cancelled.
    expect(canEmployeeCancelLeave({ status: 'approved', startDate: '2026-11-26' }, new Date('2026-11-25T18:00:00Z'))).toBe(true)
    // 26 Nov 00:30 IST: a leave starting 26 Nov has started.
    expect(canEmployeeCancelLeave({ status: 'approved', startDate: '2026-11-26' }, new Date('2026-11-25T19:00:00Z'))).toBe(false)
  })

  test('rejected, cancelled or broken records cannot be cancelled', () => {
    expect(canEmployeeCancelLeave({ status: 'rejected', startDate: '2026-12-01' }, now)).toBe(false)
    expect(canEmployeeCancelLeave({ status: 'cancelled', startDate: '2026-12-01' }, now)).toBe(false)
    expect(canEmployeeCancelLeave({ status: 'approved', startDate: 'not-a-date' }, now)).toBe(false)
    expect(canEmployeeCancelLeave(null, now)).toBe(false)
  })
})

describe('cancel guard in transitionLeaveRequest', () => {
  const { transitionLeaveRequest } = require('@/lib/leaveRequests.server')
  const { workflowStore } = require('../helpers/firestoreWorkflowStore')
  const EMP = '111111111111111111111111'
  const seed = leave => workflowStore({
    users: [{ _id: 'u-emp', isActive: true, role: 'employee', employeeId: EMP }, { _id: 'u-hr', isActive: true, role: 'hr' }],
    employees: [{ _id: EMP, firstName: 'Own', status: 'active' }],
    leaves: [{ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', employee: EMP, numberOfDays: 1, ...leave }],
  })
  const cancel = (database, user) => transitionLeaveRequest(database, user, 'aaaaaaaaaaaaaaaaaaaaaaaa', { status: 'cancelled' })

  test('employee cannot cancel approved leave that already started', async () => {
    const database = seed({ status: 'approved', startDate: new Date('2026-01-05'), endDate: new Date('2026-01-05') })
    await expect(cancel(database, { _id: 'u-emp' })).rejects.toMatchObject({ status: 409 })
    expect(await database.get('leaves', 'aaaaaaaaaaaaaaaaaaaaaaaa')).toBeTruthy()
  })

  test('employee cannot cancel a rejected leave', async () => {
    const database = seed({ status: 'rejected', startDate: new Date('2099-01-05'), endDate: new Date('2099-01-05') })
    await expect(cancel(database, { _id: 'u-emp' })).rejects.toMatchObject({ status: 409 })
  })

  test('employee can cancel own pending leave', async () => {
    const database = seed({ status: 'pending', startDate: new Date('2099-01-05'), endDate: new Date('2099-01-05') })
    await cancel(database, { _id: 'u-emp' })
    expect(await database.get('leaves', 'aaaaaaaaaaaaaaaaaaaaaaaa')).toBeNull()
  })

  test('HR can still cancel approved leave that already started', async () => {
    const database = seed({ status: 'approved', startDate: new Date('2026-01-05'), endDate: new Date('2026-01-05') })
    await cancel(database, { _id: 'u-hr' })
    expect(await database.get('leaves', 'aaaaaaaaaaaaaaaaaaaaaaaa')).toBeNull()
  })
})
