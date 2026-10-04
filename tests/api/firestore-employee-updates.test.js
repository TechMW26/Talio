import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '../../lib/platform/firestoreStore.server'
import { mutateFirestoreEmployee } from '../../lib/platform/firestoreEmployeeAccount.server'
import { recordDigest } from '../../lib/platform/firestoreCodec.cjs'
import { prepareEmployeeUpdate } from '../../lib/employeeInput.server'
import { EMPLOYEE_STORE_OPTIONS } from '../../lib/employees.server'
import { readEmployeeDetails } from '../../lib/employeeDetails.server'

jest.setTimeout(60000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
const employeeId = '111111111111111111111111', userId = '222222222222222222222222', adminId = 'aaaaaaaaaaaaaaaaaaaaaaaa', companyId = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const databaseName = 'talio_company_employee_updates'
emulator('cross-scope employee edits and exits', () => {
  let firestore, database, system, context, actor
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  beforeEach(async () => {
    const dataset = `test-employee-update-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    database = createFirestoreDatabase({ firestore, dataset, databaseName, ...EMPLOYEE_STORE_OPTIONS })
    system = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_superadmin', scope: 'system' })
    context = { firestore, dataset, catalog: { tenants: [{ tenantId: companyId, databaseName, active: true }] } }
    actor = { _id: adminId, role: 'admin', isActive: true }
    await database.create('users', actor)
    await database.create('users', { _id: userId, employeeId, role: 'employee', email: 'employee@example.test', isActive: true, authVersion: 1 })
    await database.create('employees', { _id: employeeId, userId, firstName: 'First', lastName: 'Employee', employeeCode: 'E1', email: 'employee@example.test', status: 'active', dateOfJoining: new Date('2026-01-01'), salary: { basic: 100 }, bankDetails: { accountNumber: 'private' } })
    await system.create('tenantcompanies', { _id: companyId, databaseName, isActive: true, serviceStatus: 'active', subscription: { maxUsers: 10, currentUserCount: 2 } })
    await system.create('usertenantmappings', { _id: 'mapping', databaseName, userId, email: 'employee@example.test', role: 'employee', isActive: true })
    await database.create('assets', { _id: 'asset', assignedTo: employeeId, status: 'assigned', history: [] })
  })
  afterAll(async () => firestore?.terminate())
  const change = async values => mutateFirestoreEmployee({ actor, databaseName, employeeId, expectedDigest: recordDigest(await database.get('employees', employeeId)), ...values }, { context })
  test('email changes update account and global mapping atomically and invalidate old sessions', async () => {
    await change({ patch: { email: 'updated@example.test' } })
    expect((await database.get('employees', employeeId)).email).toBe('updated@example.test')
    expect(await database.get('users', userId)).toMatchObject({ email: 'updated@example.test', authVersion: 2 })
    expect((await system.get('usertenantmappings', 'mapping')).email).toBe('updated@example.test')
    await system.create('usertenantmappings', { _id: 'other', email: 'taken@example.test', databaseName: 'talio_company_other' })
    await expect(change({ patch: { email: 'taken@example.test' } })).rejects.toMatchObject({ status: 409 })
    expect((await database.get('users', userId)).email).toBe('updated@example.test')
  })
  test('exit deactivates login/mapping, returns assets, and reconciles quota together', async () => {
    await change({ patch: { status: 'terminated' } })
    expect(await database.get('users', userId)).toMatchObject({ isActive: false, authVersion: 2 })
    expect((await system.get('usertenantmappings', 'mapping')).isActive).toBe(false)
    const asset = await database.get('assets', 'asset')
    expect(asset).toMatchObject({ assignedTo: null, status: 'available' })
    expect(asset.history).toHaveLength(1)
    expect((await system.get('tenantcompanies', companyId)).subscription.currentUserCount).toBe(1)
    await change({ patch: { status: 'active' } })
    expect((await database.get('users', userId)).isActive).toBe(true)
    expect((await system.get('tenantcompanies', companyId)).subscription.currentUserCount).toBe(2)
  })
  test('role changes recheck authority and update login permissions and mapping together', async () => {
    await database.create('roles', { _id: 'manager-role', name: 'manager' })
    await change({ systemRole: 'manager' })
    expect(await database.get('users', userId)).toMatchObject({ role: 'manager', roleId: 'manager-role', authVersion: 2 })
    expect((await system.get('usertenantmappings', 'mapping')).role).toBe('manager')
    await database.mutate('users', adminId, user => ({ ...user, role: 'employee' }))
    await expect(change({ patch: { salary: { basic: 0 } } })).rejects.toMatchObject({ status: 403 })
  })
  test('stale edits fail without losing a concurrent change', async () => {
    const expectedDigest = recordDigest(await database.get('employees', employeeId))
    await database.mutate('employees', employeeId, employee => ({ ...employee, phone: 'updated' }))
    await expect(change({ expectedDigest, patch: { firstName: 'Old' } })).rejects.toMatchObject({ status: 409 })
    expect((await database.get('employees', employeeId)).phone).toBe('updated')
  })
  test('clearing the last assignment clears the derived manager too', async () => {
    const managerId = 'dddddddddddddddddddddddd'
    await database.create('employees', { _id: managerId, employeeCode: 'M1', email: 'manager@example.test', firstName: 'Manager', designationLevel: 6 })
    const current = { ...await database.get('employees', employeeId), assignedManager: managerId, reportingManager: managerId }
    const patch = await prepareEmployeeUpdate(database, actor, current, { assignedManager: null })
    expect(patch).toMatchObject({ assignedManager: null, reportingManager: null })
  })
  test('unrelated edits preserve an existing login email when legacy employee email is missing', async () => {
    const legacyStore = createFirestoreDatabase({ firestore, dataset: context.dataset, databaseName })
    await legacyStore.mutate('employees', employeeId, record => { const next = { ...record }; delete next.email; return next })
    await change({ patch: { phone: '456' } })
    expect((await database.get('users', userId)).email).toBe('employee@example.test')
  })
  test('deletion atomically removes login and mapping while returning assets', async () => {
    await change({ remove: true })
    expect(await database.get('employees', employeeId)).toBeNull()
    expect(await database.get('users', userId)).toBeNull()
    expect(await system.get('usertenantmappings', 'mapping')).toBeNull()
    expect((await database.get('assets', 'asset')).assignedTo).toBeNull()
  })
  test('self edits cannot alter payroll/access and public reads omit financial details', async () => {
    const self = { _id: userId, employeeId, role: 'employee', isActive: true }
    await expect(change({ actor: self, patch: { status: 'terminated' } })).rejects.toMatchObject({ status: 403 })
    await change({ actor: self, patch: { phone: '1234567890' } })
    const details = await readEmployeeDetails(database, { role: 'employee', employeeId: 'other' }, employeeId)
    expect(details.salary).toBeUndefined()
    expect(details.bankDetails).toBeUndefined()
    expect((await readEmployeeDetails(database, self, employeeId)).bankDetails.accountNumber).toBe('private')
  })
  test('partial status update does not rebuild probation or overwrite legacy fields', async () => {
    const current = await database.get('employees', employeeId)
    const patch = await prepareEmployeeUpdate(database, actor, { ...current, address: 'legacy text', lastName: '' }, { status: 'active' })
    expect(patch).toEqual({ status: 'active' })
    await expect(prepareEmployeeUpdate(database, { role: 'employee', employeeId }, current, { salary: { basic: 1000 } })).rejects.toMatchObject({ status: 403 })
  })
})
