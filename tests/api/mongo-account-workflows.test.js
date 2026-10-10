import { memoryMongoDriver } from '../helpers/mongoDriver'
import { createMongoFirestoreFacade } from '../../lib/platform/mongoFirestoreFacade.server'
import { encodeMongoRecord, decodeMongoRecord, mongoRecordId } from '../../lib/platform/mongoStore.server'
import { mutateFirestoreEmployee } from '../../lib/platform/firestoreEmployeeAccount.server'
import { provisionFirestoreAccount } from '../../lib/platform/firestoreProvisioning.server'
import { recordDigest } from '../../lib/platform/firestoreCodec.cjs'

jest.mock('../../lib/platform/firestoreApplication.server', () => ({ getFirestoreProvisioningContext: jest.fn() }))
jest.mock('../../lib/passwordEncryption', () => ({ encryptPassword: value => `test-encrypted:${value}` }))

const dataset = 'test-mongo-workflows', databaseName = 'talio_company_workflows', system = 'talio_superadmin'
const adminId = 'a'.repeat(24), employeeId = 'b'.repeat(24), userId = 'c'.repeat(24), companyId = 'd'.repeat(24), mappingId = 'e'.repeat(24)
let native, context, actor, employee
function seed(database, collectionName, record, metadata) {
  const document = encodeMongoRecord({ dataset, databaseName: database, collectionName, record, envelopeMetadata: metadata })
  native.bank('talio_records').set(document._id, document)
}
function read(database, collectionName, id) { return decodeMongoRecord(native.bank('talio_records').get(mongoRecordId(dataset, database, collectionName, id))) }
function rows(database, collectionName) { return [...native.bank('talio_records').values()].filter(doc => doc.databaseName === database && doc.collectionName === collectionName).map(decodeMongoRecord) }
beforeEach(() => {
  native = memoryMongoDriver()
  const firestore = createMongoFirestoreFacade({ ...native, dataset })
  context = { ...native, firestore, dataset, catalog: { tenants: [{ tenantId: companyId, databaseName, active: true }] } }
  actor = { _id: adminId, databaseName, role: 'admin', isActive: true }
  employee = { _id: employeeId, firstName: 'Existing', lastName: 'Employee', email: 'existing@example.test', employeeCode: 'E1', status: 'active', userId }
  seed(databaseName, 'users', actor)
  seed(databaseName, 'employees', employee)
  seed(databaseName, 'users', { _id: userId, email: employee.email, employeeId, role: 'employee', isActive: true, authVersion: 0 })
  seed(system, 'tenantcompanies', { _id: companyId, databaseName, isActive: true, serviceStatus: 'active', subscription: { maxUsers: 10, currentUserCount: 2 } })
  seed(system, 'usertenantmappings', { _id: mappingId, userId, email: employee.email, role: 'employee', isActive: true, databaseName, tenantCompanyId: companyId })
})

test('real employee mutation updates linked login and mapping identities atomically', async () => {
  const result = await mutateFirestoreEmployee({ actor, databaseName, employeeId, expectedDigest: recordDigest(employee), patch: { email: 'changed@example.test', firstName: 'Changed' } }, { context })
  expect(result.employee.email).toBe('changed@example.test')
  expect(read(databaseName, 'users', userId)).toMatchObject({ email: 'changed@example.test', authVersion: 1 })
  expect(read(system, 'usertenantmappings', mappingId).email).toBe('changed@example.test')
  expect(native.bank('talio_unique_keys').size).toBeGreaterThanOrEqual(3)
})

test('real mutation preserves authorization, stale-write and foreign-key checks', async () => {
  await expect(mutateFirestoreEmployee({ actor, databaseName, employeeId, expectedDigest: 'stale', patch: { firstName: 'Wrong' } }, { context })).rejects.toMatchObject({ status: 409 })
  await expect(mutateFirestoreEmployee({ actor, databaseName, employeeId, patch: { department: 'f'.repeat(24) } }, { context })).rejects.toMatchObject({ status: 400 })
  seed(databaseName, 'users', { ...actor, role: 'employee', employeeId: 'f'.repeat(24) })
  await expect(mutateFirestoreEmployee({ actor, databaseName, employeeId, patch: { firstName: 'Wrong' } }, { context })).rejects.toMatchObject({ status: 403 })
  expect(read(databaseName, 'employees', employeeId).firstName).toBe('Existing')
})

test('real employee mutation rejects imported identity collisions without partial writes', async () => {
  seed(databaseName, 'employees', { _id: 'f'.repeat(24), email: 'taken@example.test', employeeCode: 'E2' })
  await expect(mutateFirestoreEmployee({ actor, databaseName, employeeId, patch: { email: 'taken@example.test' } }, { context })).rejects.toMatchObject({ status: 409 })
  expect(read(databaseName, 'employees', employeeId).email).toBe(employee.email)
  expect(read(databaseName, 'users', userId).email).toBe(employee.email)
  expect(read(system, 'usertenantmappings', mappingId).email).toBe(employee.email)
})

test('real account provisioning persists user, employee, mapping and quota together', async () => {
  const original = native.db.collection.bind(native.db), count = jest.fn(), activeBundleReads = jest.fn()
  native.db.collection = name => {
    const collection = original(name)
    return { ...collection, countDocuments: (...args) => { count(...args); return collection.countDocuments(...args) }, find: (filter, ...args) => {
      if (filter.collectionName === 'users' && filter.$and?.some(item => item['envelope.data.isActive']?.$eq === true)) activeBundleReads(filter)
      return collection.find(filter, ...args)
    } }
  }
  context.firestore = createMongoFirestoreFacade({ ...native, dataset })
  const result = await provisionFirestoreAccount({ email: 'new@example.test', password: 'local-test-password', employeeData: { firstName: 'New', lastName: 'Employee', employeeCode: 'E2' } }, { actor, context })
  expect(read(databaseName, 'users', result.user._id)).toMatchObject({ employeeId: result.employee._id, email: 'new@example.test' })
  expect(read(databaseName, 'employees', result.employee._id).userId).toBe(result.user._id)
  expect(rows(system, 'usertenantmappings')).toHaveLength(2)
  expect(read(system, 'tenantcompanies', companyId).subscription.currentUserCount).toBe(3)
  expect(native.bank('talio_unique_keys').size).toBe(4)
  expect(count).toHaveBeenCalledTimes(1)
  expect(count.mock.calls[0][1]).toMatchObject({ limit: 10001, session: expect.anything() })
  expect(activeBundleReads).not.toHaveBeenCalled()
})

test('aggregate provisioning quota rejects a full company without partial identities', async () => {
  seed(system, 'tenantcompanies', { _id: companyId, databaseName, isActive: true, serviceStatus: 'active', subscription: { maxUsers: 2, currentUserCount: 2 } })
  await expect(provisionFirestoreAccount({ email: 'quota@example.test', password: 'local-test-password' }, { actor, context })).rejects.toMatchObject({ status: 409 })
  expect(rows(databaseName, 'users')).toHaveLength(2)
  expect(rows(system, 'usertenantmappings')).toHaveLength(1)
  expect(native.bank('talio_unique_keys').size).toBe(0)
})

test('simultaneous actual provisioning with the same identity leaves no orphan records', async () => {
  const input = { email: 'race@example.test', password: 'local-test-password', employeeData: { firstName: 'Race', lastName: 'Employee', employeeCode: 'E2' } }
  const results = await Promise.allSettled([provisionFirestoreAccount(input, { actor, context }), provisionFirestoreAccount(input, { actor, context })])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.find(result => result.status === 'rejected').reason.status).toBe(409)
  expect(rows(databaseName, 'users')).toHaveLength(3)
  expect(rows(databaseName, 'employees')).toHaveLength(2)
  expect(rows(system, 'usertenantmappings')).toHaveLength(2)
})

test('inactive and unregistered tenant provisioning stays denied', async () => {
  const input = { email: 'denied@example.test', password: 'local-test-password' }
  context.catalog.tenants = []
  await expect(provisionFirestoreAccount(input, { actor, context })).rejects.toMatchObject({ status: 409 })
  expect(rows(databaseName, 'users')).toHaveLength(2)
})
