jest.mock('../../lib/rbacSessionRefresh', () => ({ refreshAffectedUsers: jest.fn().mockResolvedValue({}) }))
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '../../lib/platform/firestoreStore.server'
import { ADMIN_OPERATION_OPTIONS, liveUsers, reactivateUser, broadcastRefresh, clearTenantChats, employeePresence } from '../../lib/adminOperations.server'
import { refreshAffectedUsers } from '../../lib/rbacSessionRefresh'
jest.setTimeout(60000)
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
suite('native administrative operations', () => {
  let firestore, database
  const adminId = 'aaaaaaaaaaaaaaaaaaaaaaaa', headId = 'bbbbbbbbbbbbbbbbbbbbbbbb', otherId = 'cccccccccccccccccccccccc'
  const headEmployee = '111111111111111111111111', otherEmployee = '222222222222222222222222', department = 'dddddddddddddddddddddddd', otherDepartment = 'eeeeeeeeeeeeeeeeeeeeeeee'
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  beforeEach(async () => {
    jest.clearAllMocks()
    database = createFirestoreDatabase({ firestore, dataset: `test-admin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, databaseName: 'talio_company_admin_test', ...ADMIN_OPERATION_OPTIONS })
    await database.create('users', { _id: adminId, isActive: true, role: 'admin' })
    await database.create('users', { _id: headId, isActive: true, role: 'employee', employeeId: headEmployee })
    await database.create('users', { _id: otherId, isActive: true, role: 'employee', employeeId: otherEmployee })
    await database.create('departments', { _id: department, isActive: true, name: 'Mine', head: headEmployee })
    await database.create('departments', { _id: otherDepartment, isActive: true, name: 'Other' })
    await database.create('employees', { _id: headEmployee, firstName: 'Head', department, status: 'active' })
    await database.create('employees', { _id: otherEmployee, firstName: 'Other', department: otherDepartment, status: 'active' })
  })
  afterAll(() => firestore.terminate())
  test('department heads see only their own department, using current role data', async () => {
    const result = await liveUsers(database, { _id: headId, role: 'admin' })
    expect(result.users.all.map(u => u.userId)).toEqual([headId])
    expect(result.permissions.canRefresh).toBe(false)
    await expect(liveUsers(database, { _id: otherId, role: 'admin' })).rejects.toMatchObject({ status: 403 })
  })
  test('reactivation preserves fields and permits only profile suspensions', async () => {
    await database.mutate('users', otherId, u => ({ ...u, isActive: false, suspensionReason: 'profile_incomplete', profileCompletion: { status: 'pending', firstLoginAt: new Date() } }))
    await reactivateUser(database, { _id: adminId }, { userId: otherId, additionalDays: 7 })
    const user = await database.get('users', otherId)
    expect(user.isActive).toBe(true)
    expect(user.profileCompletion.status).toBe('pending')
    expect(user.profileCompletion.firstLoginAt).toBeTruthy()
    expect(user.authVersion).toBe(1)
    await expect(reactivateUser(database, { _id: adminId }, { userId: headId })).rejects.toMatchObject({ status: 400 })
  })
  test('broadcast validates targets and never trusts submitted roles', async () => {
    await expect(broadcastRefresh(database, { _id: headId, role: 'admin' }, { target: 'all' })).rejects.toMatchObject({ status: 403 })
    await broadcastRefresh(database, { _id: adminId }, { target: 'department', departmentId: department })
    expect(refreshAffectedUsers).toHaveBeenCalledWith(expect.objectContaining({ userIds: [headId], databaseName: database.databaseName }))
  })
  test('presence is tenant-scoped and chat clearing checks current admin status', async () => {
    await database.create('userpresences', { _id: headId, userId: headId, employeeId: headEmployee, lastHeartbeat: new Date() })
    expect((await employeePresence(database, [headEmployee, otherEmployee]))[headEmployee].online).toBe(true)
    await database.create('chats', { _id: 'ffffffffffffffffffffffff', participants: [headEmployee] })
    await expect(clearTenantChats(database, { _id: otherId, role: 'admin' })).rejects.toMatchObject({ status: 403 })
    expect(await clearTenantChats(database, { _id: adminId })).toEqual({ deletedChats: 1, deletedMessages: 0 })
  })
  test('large department, attendance and presence batches respect Firestore component limits', async () => {
    const now = new Date(), ids = Array.from({ length: 31 }, (_, index) => (1000 + index).toString(16).padStart(24, '0'))
    await Promise.all(ids.map(async (employeeId, index) => {
      const userId = (2000 + index).toString(16).padStart(24, '0')
      await database.create('employees', { _id: employeeId, firstName: `Person ${index}`, department, status: 'active' })
      await database.create('users', { _id: userId, employeeId, isActive: true, role: 'employee' })
      await database.create('userpresences', { _id: userId, userId, employeeId, lastHeartbeat: now })
      await database.create('attendances', { _id: employeeId, employee: employeeId, date: now, checkIn: now, status: 'present' })
    }))
    const people = await liveUsers(database, { _id: adminId }, now)
    expect(people.summary.totalUsers).toBe(33)
    expect(people.summary.checkedInToday).toBe(31)
    expect(people.summary.activeNow).toBe(31)
    expect(Object.values(await employeePresence(database, ids, now)).filter(value => value.online)).toHaveLength(31)
    expect((await broadcastRefresh(database, { _id: adminId }, { target: 'department', departmentId: department })).targetCount).toBe(32)
  })
})
