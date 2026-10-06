import { Firestore } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { createProbationRequest, decideProbationRequest } from '@/lib/hrms/probationFirestore.server'

jest.setTimeout(45000)
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
suite('native probation transactions', () => {
  let firestore, database
  const employeeId = '111111111111111111111111', managerId = '222222222222222222222222'
  const actor = { _id: '333333333333333333333333', employeeId: managerId, role: 'manager' }
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  afterAll(async () => { await firestore?.terminate() })
  beforeEach(async () => {
    database = createFirestoreDatabase({ firestore, dataset: `test-probation-${Date.now()}-${randomBytes(5).toString('hex')}`, databaseName: 'talio_company_test', queryFields: { users: ['employeeId'], probationapprovals: ['employee', 'status'], actionablenotifications: ['user', 'reference.model', 'reference.id', 'status'] } })
    await database.create('employees', { _id: employeeId, firstName: 'Test', lastName: 'Employee', reportingManager: managerId, employmentType: 'full-time', dateOfJoining: new Date('2026-01-01'), lifecycle: { probation: { applicable: true, status: 'active', startDate: '2026-01-01', reviewDate: '2026-07-01' } } })
    await database.create('users', { _id: actor._id, employeeId: managerId, isActive: true })
  })
  const create = () => createProbationRequest(database, { actor, employeeId, requestData: { requestType: 'confirmation', extensionMonths: null, requestRemarks: '' } })
  test('concurrent requests persist exactly one approval and its non-dismissible prompt', async () => {
    const result = await Promise.allSettled([create(), create()])
    expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(result.find(item => item.status === 'rejected').reason.status).toBe(409)
    expect(await database.count('probationapprovals')).toBe(1)
    expect((await database.list('actionablenotifications')).records[0]).toMatchObject({ displaySettings: { dismissible: false }, status: 'pending' })
  })
  test('notification failure rolls back request and serialization lock', async () => {
    const failing = { ...database, transaction: callback => database.transaction(tx => callback({ ...tx, create: (name, record) => name === 'actionablenotifications' ? Promise.reject(new Error('Notification unavailable')) : tx.create(name, record) })) }
    await expect(createProbationRequest(failing, { actor, employeeId, requestData: { requestType: 'confirmation' } })).rejects.toThrow('Notification unavailable')
    expect(await database.count('probationapprovals')).toBe(0)
    expect(await database.get('probationlocks', employeeId)).toBeNull()
  })
  test('concurrent decisions commit lifecycle and notification once', async () => {
    const { approval } = await create()
    const args = { actor, employeeId, approvalId: approval._id, decision: 'approve', decisionRemarks: 'All requirements met' }
    const results = await Promise.allSettled([decideProbationRequest(database, args), decideProbationRequest(database, args)])
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect((await database.get('employees', employeeId)).lifecycle.probation.status).toBe('confirmed')
    expect((await database.get('probationapprovals', approval._id)).status).toBe('approved')
    expect((await database.list('actionablenotifications')).records[0].status).toBe('actioned')
  })
  test('wrong approver cannot decide, rejection leaves lifecycle untouched', async () => {
    const { approval } = await create(), employee = await database.get('employees', employeeId)
    const args = { employeeId, approvalId: approval._id, decision: 'reject', decisionRemarks: 'More training needed' }
    await expect(decideProbationRequest(database, { ...args, actor: { _id: '444444444444444444444444' } })).rejects.toMatchObject({ status: 403 })
    await decideProbationRequest(database, { ...args, actor })
    expect(await database.get('employees', employeeId)).toEqual(employee)
  })
})
