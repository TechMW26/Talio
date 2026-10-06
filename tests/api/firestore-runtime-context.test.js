jest.mock('@/lib/platform/firestore.server', () => ({ getTalioFirestore: jest.fn() }))
import { Firestore } from 'firebase-admin/firestore'
import { getTalioFirestore } from '@/lib/platform/firestore.server'
import { getFirestoreApplicationContext, getFirestoreSystemDatabase, getFirestoreTenantDatabase, registerFirestoreTenant, setFirestoreTenantActive } from '@/lib/platform/firestoreApplication.server'

jest.setTimeout(60000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
emulator('native application catalog and tenant repository boundaries', () => {
  let firestore, dataset, originalDataset, originalMode, root
  const tenantId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
  const databaseName = 'talio_company_native_one'
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    originalDataset = process.env.FIRESTORE_DATASET
    originalMode = process.env.NODE_ENV
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
    getTalioFirestore.mockReturnValue(firestore)
  })
  beforeEach(async () => {
    dataset = `test-context-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    process.env.FIRESTORE_DATASET = dataset
    root = firestore.collection('talioDatasets').doc(dataset)
    await root.set({ status: 'verified-local-dataset', purpose: 'local-acceptance-only', tenants: [{ tenantId, databaseName, active: true }, { tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb', databaseName: 'talio_company_native_two', active: true }] })
  })
  afterEach(() => { process.env.NODE_ENV = originalMode })
  afterAll(async () => {
    if (originalDataset === undefined) delete process.env.FIRESTORE_DATASET
    else process.env.FIRESTORE_DATASET = originalDataset
    await firestore?.terminate()
  })

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

  test('unverified catalog fails closed and subsequent verified requests recover', async () => {
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

  test('a different physical database cannot inherit another database catalog verification', async () => {
    await getFirestoreApplicationContext(databaseName)
    const get = jest.fn(async () => ({ exists: false }))
    getTalioFirestore.mockReturnValueOnce({ collection: () => ({ doc: () => ({ get }) }) })
    await expect(getFirestoreApplicationContext(databaseName)).rejects.toThrow('not passed verification')
    expect(get).toHaveBeenCalledTimes(1)
  })

  test('protected authorization observes an archive made by another worker despite a warm catalog', async () => {
    await getFirestoreTenantDatabase(databaseName)
    // A different worker updates Firestore without clearing this module cache.
    const catalog = (await root.get()).data()
    await root.update({ tenants: catalog.tenants.map(tenant => tenant.databaseName === databaseName ? { ...tenant, active: false } : tenant) })
    await expect(getFirestoreTenantDatabase(databaseName, { freshAuthorization: true })).rejects.toThrow('not registered')
    const outage = jest.fn(async () => { throw new Error('catalog unavailable') })
    getTalioFirestore.mockReturnValueOnce({ collection: () => ({ doc: () => ({ get: outage }) }) })
    await expect(getFirestoreTenantDatabase(databaseName, { freshAuthorization: true })).rejects.toThrow('catalog unavailable')
  })

  test('company registration requires persisted matching identity and is idempotent', async () => {
    const system = await getFirestoreSystemDatabase()
    const company = { _id: 'cccccccccccccccccccccccc', databaseName: 'talio_company_new', isActive: true }
    await expect(registerFirestoreTenant(company)).rejects.toThrow('must exist')
    await system.create('tenantcompanies', company)
    await Promise.all([registerFirestoreTenant(company), registerFirestoreTenant(company)])
    expect((await root.get()).get('tenants').filter(row => row.databaseName === company.databaseName)).toHaveLength(1)
    expect((await getFirestoreApplicationContext(company.databaseName)).databaseName).toBe(company.databaseName)
    await expect(registerFirestoreTenant({ ...company, databaseName: 'talio_company_mismatch' })).rejects.toThrow('must exist')
  })

  test('archive rechecks admin, switches registry and catalog together and preserves tenant data', async () => {
    const system = await getFirestoreSystemDatabase()
    const tenant = await getFirestoreTenantDatabase(databaseName)
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
