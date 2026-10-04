import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '../../lib/platform/firestoreStore.server'
import { LEAVE_STORE_OPTIONS, submitLeaveRequest, transitionLeaveRequest, listLeaveRequests } from '../../lib/leaveRequests.server'
import { LEAVE_TYPE_STORE_OPTIONS, saveLeaveType, deleteLeaveType, normalizeLeaveTypeInput } from '../../lib/leaveTypes.server'
import { adjustLeaveBalance } from '../../lib/leaveBalances.server'

jest.setTimeout(60000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
describe('native leave type schema', () => {
  test('mirrors legacy aliases and drops caller-controlled IDs', () => {
    const result = normalizeLeaveTypeInput({ name: 'Annual', code: 'AL', daysPerYear: 12, _id: 'injected' })
    expect(result).toMatchObject({ maxDaysPerYear: 12, daysPerYear: 12, isActive: true })
    expect(result._id).toBeUndefined()
    expect(() => normalizeLeaveTypeInput({ name: 'Annual', code: 'AL', daysPerYear: -1 })).toThrow()
  })
})
emulator('atomic native leave requests', () => {
  let firestore, database, actor, manager, admin, type
  const employeeId = '111111111111111111111111', managerId = '222222222222222222222222', userId = 'aaaaaaaaaaaaaaaaaaaaaaaa', managerUserId = 'bbbbbbbbbbbbbbbbbbbbbbbb', adminId = 'cccccccccccccccccccccccc'
  const request = { startDate: '2026-10-05', endDate: '2026-10-06', reason: 'Personal leave' }
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  beforeEach(async () => {
    const dataset = `test-leave-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    database = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_company_leave_test', queryFields: { ...LEAVE_STORE_OPTIONS.queryFields, leavetypes: LEAVE_TYPE_STORE_OPTIONS.queryFields.leavetypes }, constraints: { ...LEAVE_STORE_OPTIONS.constraints, ...LEAVE_TYPE_STORE_OPTIONS.constraints } })
    actor = { _id: userId, employeeId, role: 'employee', isActive: true }
    manager = { _id: managerUserId, employeeId: managerId, role: 'manager', isActive: true }
    admin = { _id: adminId, role: 'admin', isActive: true }
    for (const record of [actor, manager, admin]) await database.create('users', record)
    await database.create('employees', { _id: employeeId, firstName: 'Employee', status: 'active', assignedManager: managerId, designationLevel: 1 })
    await database.create('employees', { _id: managerId, firstName: 'Manager', status: 'active', designationLevel: 6 })
    type = await saveLeaveType(database, admin, { name: 'Annual', code: 'AL', maxDaysPerYear: 12 })
    await adjustLeaveBalance(database, admin, { employee: employeeId, leaveType: type._id, year: 2026, totalDays: 5 })
  })
  afterAll(async () => firestore?.terminate())
  const balance = async () => (await database.list('leavebalances')).records[0]
  const submit = extra => submitLeaveRequest(database, actor, { ...request, leaveType: type._id, ...extra })
  test('reserves once, approves once, and cancellation restores once', async () => {
    const record = await submit()
    expect(await balance()).toMatchObject({ pending: 2, usedDays: 0, remainingDays: 3 })
    const outcomes = await Promise.allSettled([1, 2].map(() => transitionLeaveRequest(database, manager, record._id, { status: 'approved' })))
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(await balance()).toMatchObject({ pending: 0, usedDays: 2, remainingDays: 3 })
    await transitionLeaveRequest(database, actor, record._id, { status: 'cancelled' })
    await expect(transitionLeaveRequest(database, actor, record._id, { status: 'cancelled' })).rejects.toMatchObject({ status: 404 })
    expect(await balance()).toMatchObject({ pending: 0, usedDays: 0, remainingDays: 5 })
  })
  test('concurrent requests cannot over-reserve a balance', async () => {
    const results = await Promise.allSettled([1, 2, 3].map(() => submit()))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2)
    expect(await balance()).toMatchObject({ pending: 4, remainingDays: 1 })
  })
  test('legacy unreserved pending records deduct on approval and rejection does not change balances', async () => {
    const id = 'dddddddddddddddddddddddd'
    await database.create('leaves', { _id: id, employee: employeeId, leaveType: type._id, startDate: new Date('2026-10-05'), endDate: new Date('2026-10-06'), days: 2, status: 'pending', createdAt: new Date() })
    await transitionLeaveRequest(database, manager, id, { status: 'approved' })
    expect(await balance()).toMatchObject({ pending: 0, usedDays: 2, remainingDays: 3 })
    const next = await submit()
    await transitionLeaveRequest(database, manager, next._id, { status: 'rejected', reason: 'Not approved' })
    expect(await balance()).toMatchObject({ pending: 0, usedDays: 2, remainingDays: 3 })
  })
  test('both employee and stale manager privileges fail closed', async () => {
    const record = await submit()
    await expect(transitionLeaveRequest(database, actor, record._id, { status: 'approved' })).rejects.toMatchObject({ status: 403 })
    await database.mutate('users', managerUserId, user => ({ ...user, role: 'employee' }))
    await expect(transitionLeaveRequest(database, manager, record._id, { status: 'approved' })).rejects.toMatchObject({ status: 403 })
    expect(await balance()).toMatchObject({ pending: 2, usedDays: 0 })
  })
  test('regular users cannot list another employee requests', async () => {
    await submit()
    const other = { _id: 'eeeeeeeeeeeeeeeeeeeeeeee', employeeId: managerId, role: 'employee', isActive: true }
    await database.create('users', other)
    expect(await listLeaveRequests(database, other, new URLSearchParams({ employeeId }))).toEqual([])
    expect(await listLeaveRequests(database, manager, new URLSearchParams({ status: 'pending' }))).toHaveLength(1)
  })
  test('half-day annual limits survive concurrent submissions', async () => {
    await database.create('companysettings', { _id: 'settings', leave: { halfDayPolicy: { defaultAnnualLimit: 1, limitsByLevel: [] } } })
    const results = await Promise.allSettled([1, 2].map(() => submit({ leaveType: undefined, endDate: request.startDate, requestType: 'half_day' })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect((await database.list('leaves')).records).toHaveLength(1)
  })
  test('leave types with linked balances cannot be hard-deleted', async () => {
    await expect(deleteLeaveType(database, admin, type._id)).rejects.toMatchObject({ status: 409 })
    expect(await saveLeaveType(database, admin, { isActive: false }, type._id)).toMatchObject({ isActive: false })
    await expect(submit()).rejects.toThrow('unavailable')
  })
})
