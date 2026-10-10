jest.mock('../../lib/platform/mongo.server', () => ({ getTalioMongoClient: jest.fn(), getTalioMongoDatabase: jest.fn() }))
jest.mock('../../lib/platform/mongoFirestoreFacade.server', () => ({ createMongoFirestoreFacade: jest.fn(() => ({})) }))
import { getTalioMongoClient, getTalioMongoDatabase } from '../../lib/platform/mongo.server'
import { getFirestoreApplicationContext } from '../../lib/platform/firestoreApplication.server'

describe('native dataset readiness boundary', () => {
  const keys = ['MONGODB_DATASET', 'MONGODB_DATABASE', 'TALIO_DATABASE_PROVIDER', 'NODE_ENV']
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  let catalog, get
  beforeEach(() => {
    process.env.MONGODB_DATASET = `local-fixture-${Date.now()}-${Math.floor(Math.random() * 1000000)}`
    process.env.MONGODB_DATABASE = 'talio'
    process.env.TALIO_DATABASE_PROVIDER = 'mongodb'
    process.env.NODE_ENV = 'test'
    catalog = { mongoVerified: true, status: 'verified-local-dataset', purpose: 'local-acceptance-only', tenants: [{ databaseName: 'talio_company_first' }] }
    get = jest.fn(async () => catalog)
    getTalioMongoClient.mockResolvedValue({})
    getTalioMongoDatabase.mockResolvedValue({ collection: () => ({ findOne: get }) })
  })
  afterAll(() => {
    for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key] }
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
    catalog = { mongoVerified: true, ...flags, tenants: catalog.tenants }
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
    getTalioMongoClient.mockClear()
    await expect(getFirestoreApplicationContext('talio_superadmin')).rejects.toThrow('Registered tenant')
    expect(getTalioMongoClient).not.toHaveBeenCalled()
  })
})
