jest.mock('../../lib/platform/firestore.server', () => ({ getTalioFirestore: jest.fn() }))
import { getTalioFirestore } from '../../lib/platform/firestore.server'
import { getFirestoreApplicationContext } from '../../lib/platform/firestoreApplication.server'

describe('native dataset readiness boundary', () => {
  const original = { dataset: process.env.FIRESTORE_DATASET, environment: process.env.NODE_ENV }
  let catalog, get
  beforeEach(() => {
    process.env.FIRESTORE_DATASET = `local-fixture-${Date.now()}-${Math.floor(Math.random() * 1000000)}`
    process.env.NODE_ENV = 'test'
    catalog = { status: 'verified-local-dataset', purpose: 'local-acceptance-only', tenants: [{ databaseName: 'talio_company_first' }] }
    get = jest.fn(async () => ({ exists: true, data: () => catalog }))
    getTalioFirestore.mockReturnValue({ collection: () => ({ doc: () => ({ get }) }) })
  })
  afterAll(() => {
    if (original.dataset === undefined) delete process.env.FIRESTORE_DATASET
    else process.env.FIRESTORE_DATASET = original.dataset
    process.env.NODE_ENV = original.environment
  })
  test('does not permit reads of an unverified dataset or unknown tenant', async () => {
    catalog.status = 'materializing'
    await expect(getFirestoreApplicationContext('talio_company_first')).rejects.toThrow('verification')
    catalog.status = 'verified-local-dataset'
    await expect(getFirestoreApplicationContext('talio_company_other')).rejects.toThrow('not registered')
  })
  test('never uses a local snapshot in production, including cached configuration', async () => {
    expect((await getFirestoreApplicationContext('talio_company_first')).databaseName).toBe('talio_company_first')
    process.env.NODE_ENV = 'production'
    await expect(getFirestoreApplicationContext('talio_company_first')).rejects.toThrow('must not be used in production')
  })
  test.each([
    { status: 'verified-local-dataset', purpose: 'production', applicationCutover: true },
    { status: 'ready', purpose: 'staging', applicationCutover: true },
    { status: 'ready', applicationCutover: true },
    { status: 'ready', purpose: 'production', applicationCutover: false },
    { status: 'ready', purpose: 'production' },
    { status: 'ready', purpose: 'production', applicationCutover: 'true' },
  ])('production rejects an incomplete cutover: %j', async (flags) => {
    catalog = { ...flags, tenants: catalog.tenants }
    process.env.NODE_ENV = 'production'
    await expect(getFirestoreApplicationContext('talio_company_first')).rejects.toThrow('live cutover verification')
  })
  test('cached staging configuration cannot bypass production cutover checks', async () => {
    catalog = { ...catalog, status: 'ready', purpose: 'staging', applicationCutover: false }
    await getFirestoreApplicationContext('talio_company_first')
    process.env.NODE_ENV = 'production'
    await expect(getFirestoreApplicationContext('talio_company_first')).rejects.toThrow('live cutover verification')
    expect(get).toHaveBeenCalledTimes(1)
  })
  test('explicit live cutover permits only registered active tenants', async () => {
    catalog = { ...catalog, status: 'ready', purpose: 'production', applicationCutover: true }
    catalog.tenants.push({ databaseName: 'talio_company_archived', active: false })
    process.env.NODE_ENV = 'production'
    expect((await getFirestoreApplicationContext('talio_company_first')).databaseName).toBe('talio_company_first')
    await expect(getFirestoreApplicationContext('talio_company_other')).rejects.toThrow('not registered')
    await expect(getFirestoreApplicationContext('talio_company_archived')).rejects.toThrow('not registered')
  })
  test('rejects system names before obtaining a server connection', async () => {
    getTalioFirestore.mockClear()
    await expect(getFirestoreApplicationContext('talio_superadmin')).rejects.toThrow('Registered tenant')
    expect(getTalioFirestore).not.toHaveBeenCalled()
  })
})
