jest.mock('@/lib/platform/mongo.server', () => ({ getTalioMongoClient: jest.fn(), getTalioMongoDatabase: jest.fn() }))
import { getTalioMongoClient, getTalioMongoDatabase } from '@/lib/platform/mongo.server'
import { getFirestoreApplicationContext, getFirestoreSystemDatabase, getFirestoreTenantDatabase, registerFirestoreTenant, setFirestoreTenantActive } from '@/lib/platform/firestoreApplication.server'
import { createMongoFirestoreFacade } from '@/lib/platform/mongoFirestoreFacade.server'
import { memoryMongoDriver } from '../helpers/mongoDriver'

describe('Mongo application catalog and tenant repository boundaries', () => {
  let native, dataset, root
  const tenantId = 'aaaaaaaaaaaaaaaaaaaaaaaa', databaseName = 'talio_company_native_one'
  const keys = ['MONGODB_DATASET', 'MONGODB_DATABASE', 'TALIO_DATABASE_PROVIDER', 'NODE_ENV']
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  beforeEach(() => {
    native = memoryMongoDriver()
    dataset = `test-context-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    process.env.MONGODB_DATASET = dataset
    process.env.MONGODB_DATABASE = 'talio'
    process.env.TALIO_DATABASE_PROVIDER = 'mongodb'
    process.env.NODE_ENV = 'test'
    getTalioMongoClient.mockResolvedValue(native.client)
    getTalioMongoDatabase.mockResolvedValue(native.db)
    native.bank('talio_catalogs').set(dataset, { _id: dataset, mongoVerified: true, status: 'verified-local-dataset', purpose: 'local-acceptance-only', tenants: [{ tenantId, databaseName, active: true }, { tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb', databaseName: 'talio_company_native_two', active: true }] })
    root = createMongoFirestoreFacade({ ...native, dataset }).collection('talioDatasets').doc(dataset)
  })
  afterAll(() => { for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key] } })

  test('same record IDs remain isolated across tenants and the system registry', async () => {
    const [one, two, system] = await Promise.all([getFirestoreTenantDatabase(databaseName), getFirestoreTenantDatabase('talio_company_native_two'), getFirestoreSystemDatabase()])
    await one.create('users', { _id: 'same-id', email: 'one@example.test' })
    await two.create('users', { _id: 'same-id', email: 'two@example.test' })
    expect((await one.get('users', 'same-id')).email).toBe('one@example.test')
    expect((await two.get('users', 'same-id')).email).toBe('two@example.test')
    expect(await system.get('users', 'same-id')).toBeNull()
    await expect(getFirestoreTenantDatabase('talio_superadmin')).rejects.toThrow('Registered tenant')
    await expect(getFirestoreTenantDatabase('talio_company_unregistered')).rejects.toThrow('not registered')
  })

  test('unverified catalog fails closed and a verified request can recover', async () => {
    await root.update({ status: 'copy-in-progress' })
    await expect(getFirestoreApplicationContext(databaseName)).rejects.toThrow('not passed verification')
    await root.update({ status: 'verified-local-dataset' })
    expect((await getFirestoreApplicationContext(databaseName)).databaseName).toBe(databaseName)
  })

  test('production cannot reuse a cached local-only dataset', async () => {
    await getFirestoreApplicationContext(databaseName)
    process.env.NODE_ENV = 'production'
    await expect(getFirestoreApplicationContext(databaseName)).rejects.toThrow('must not be used in production')
  })

  test('a different native client cannot inherit another physical database verification', async () => {
    await getFirestoreApplicationContext(databaseName)
    const other = memoryMongoDriver()
    getTalioMongoClient.mockResolvedValueOnce(other.client)
    getTalioMongoDatabase.mockResolvedValueOnce(other.db)
    await expect(getFirestoreApplicationContext(databaseName)).rejects.toThrow('not passed verification')
  })

  test('fresh authorization observes tenant archive by another worker', async () => {
    await getFirestoreTenantDatabase(databaseName)
    const catalog = (await root.get()).data()
    await root.update({ tenants: catalog.tenants.map(tenant => tenant.databaseName === databaseName ? { ...tenant, active: false } : tenant) })
    await expect(getFirestoreTenantDatabase(databaseName, { freshAuthorization: true })).rejects.toThrow('not registered')
    const failure = { collection: () => ({ findOne: async () => { throw new Error('catalog unavailable') } }) }
    getTalioMongoDatabase.mockResolvedValueOnce(failure)
    await expect(getFirestoreTenantDatabase(databaseName, { freshAuthorization: true })).rejects.toThrow('catalog unavailable')
  })

  test('company registration requires persisted identity and remains idempotent', async () => {
    const system = await getFirestoreSystemDatabase()
    const company = { _id: 'cccccccccccccccccccccccc', databaseName: 'talio_company_new', isActive: true }
    await expect(registerFirestoreTenant(company)).rejects.toThrow('must exist')
    await system.create('tenantcompanies', company)
    await Promise.all([registerFirestoreTenant(company), registerFirestoreTenant(company)])
    expect((await root.get()).get('tenants').filter(row => row.databaseName === company.databaseName)).toHaveLength(1)
    expect((await getFirestoreApplicationContext(company.databaseName)).databaseName).toBe(company.databaseName)
    await expect(registerFirestoreTenant({ ...company, databaseName: 'talio_company_mismatch' })).rejects.toThrow('must exist')
  })

  test('archive rechecks admin, commits registry and catalog together, and retains tenant data', async () => {
    const system = await getFirestoreSystemDatabase(), tenant = await getFirestoreTenantDatabase(databaseName)
    await system.create('tenantcompanies', { _id: tenantId, databaseName, isActive: true })
    await system.create('superadmins', { _id: 'owner', isActive: true, permissions: { canDeleteCompanies: true } })
    await tenant.create('users', { _id: 'preserved', email: 'kept@example.test' })
    await expect(setFirestoreTenantActive(tenantId, false, { superadminId: 'missing' })).rejects.toMatchObject({ status: 403 })
    await setFirestoreTenantActive(tenantId, false, { superadminId: 'owner' })
    expect((await system.get('tenantcompanies', tenantId)).isActive).toBe(false)
    await expect(getFirestoreTenantDatabase(databaseName)).rejects.toThrow('not registered')
    expect((await tenant.get('users', 'preserved')).email).toBe('kept@example.test')
    await setFirestoreTenantActive(tenantId, true, { superadminId: 'owner' })
    expect((await getFirestoreApplicationContext(databaseName)).databaseName).toBe(databaseName)
  })
})
