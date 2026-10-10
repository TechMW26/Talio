jest.mock('../../lib/platform/firestore.server', () => ({ getTalioFirestore: jest.fn() }))
jest.mock('../../lib/platform/mongo.server', () => ({ getTalioMongoClient: jest.fn(), getTalioMongoDatabase: jest.fn() }))
jest.mock('../../lib/platform/mongoFirestoreFacade.server', () => ({ createMongoFirestoreFacade: jest.fn(() => ({ collection: jest.fn() })) }))
import { getTalioFirestore } from '../../lib/platform/firestore.server'
import { getTalioMongoClient, getTalioMongoDatabase } from '../../lib/platform/mongo.server'
import { getFirestoreApplicationContext } from '../../lib/platform/firestoreApplication.server'

describe('explicit Mongo application cutover and tenant authorization', () => {
  const keys = ['TALIO_DATABASE_PROVIDER', 'MONGODB_DATABASE', 'MONGODB_DATASET', 'NODE_ENV']
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  let catalog, findOne, client, db
  beforeEach(() => {
    process.env.TALIO_DATABASE_PROVIDER = 'mongodb'
    process.env.MONGODB_DATABASE = 'talio'
    process.env.MONGODB_DATASET = `mongo-test-${Date.now()}-${Math.floor(Math.random() * 1000000)}`
    process.env.NODE_ENV = 'test'
    catalog = { status: 'ready', purpose: 'production', applicationCutover: true, mongoVerified: true, tenants: [{ databaseName: 'talio_company_first' }, { databaseName: 'talio_company_archived', active: false }] }
    findOne = jest.fn(async () => catalog)
    client = { startSession: jest.fn() }
    db = { collection: jest.fn(() => ({ findOne })) }
    getTalioMongoClient.mockResolvedValue(client)
    getTalioMongoDatabase.mockResolvedValue(db)
    getTalioFirestore.mockClear()
  })
  afterAll(() => { for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key] } })
  test('never reads an imported but unverified Mongo dataset', async () => {
    catalog.mongoVerified = false
    await expect(getFirestoreApplicationContext('talio_company_first')).rejects.toThrow('parity verification')
    expect(getTalioFirestore).not.toHaveBeenCalled()
  })
  test('retains selected provider context and blocks unknown/archived tenants', async () => {
    expect(await getFirestoreApplicationContext('talio_company_first')).toMatchObject({ provider: 'mongodb', client, db, databaseName: 'talio_company_first' })
    await expect(getFirestoreApplicationContext('talio_company_other')).rejects.toThrow('not registered')
    await expect(getFirestoreApplicationContext('talio_company_archived')).rejects.toThrow('not registered')
    expect(findOne).toHaveBeenCalledTimes(1)
  })
  test('fresh authorization bypasses cache to apply tenant revocation', async () => {
    await getFirestoreApplicationContext('talio_company_first')
    catalog = { ...catalog, tenants: [] }
    await expect(getFirestoreApplicationContext('talio_company_first', { freshAuthorization: true })).rejects.toThrow('not registered')
    expect(findOne).toHaveBeenCalledTimes(2)
  })
  test('concurrent ordinary domain reads share the same cold catalog lookup', async () => {
    let finish
    findOne.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = Array.from({ length: 12 }, () => getFirestoreApplicationContext('talio_company_first'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(findOne).toHaveBeenCalledTimes(1)
    finish(catalog)
    const results = await Promise.all(pending)
    expect(results).toHaveLength(12)
    expect(results.every(result => result.provider === 'mongodb')).toBe(true)
  })
  test('fresh revocation cannot join an older catalog request or be overwritten by it', async () => {
    let finishOlder
    const olderCatalog = { ...catalog, tenants: [...catalog.tenants] }
    findOne.mockImplementationOnce(() => new Promise(resolve => { finishOlder = resolve }))
    const olderRead = getFirestoreApplicationContext('talio_company_first')
    await new Promise(resolve => setTimeout(resolve, 0))
    catalog = { ...catalog, tenants: [] }
    await expect(getFirestoreApplicationContext('talio_company_first', { freshAuthorization: true })).rejects.toThrow('not registered')
    finishOlder(olderCatalog)
    await olderRead
    await expect(getFirestoreApplicationContext('talio_company_first')).rejects.toThrow('not registered')
    expect(findOne).toHaveBeenCalledTimes(2)
  })
  test('a failed fresh lookup does not leave a usable stale cached catalog', async () => {
    await getFirestoreApplicationContext('talio_company_first')
    findOne.mockRejectedValueOnce(new Error('temporary catalog failure'))
    await expect(getFirestoreApplicationContext('talio_company_first', { freshAuthorization: true })).rejects.toThrow('temporary catalog failure')
    catalog = { ...catalog, tenants: [] }
    await expect(getFirestoreApplicationContext('talio_company_first')).rejects.toThrow('not registered')
    expect(findOne).toHaveBeenCalledTimes(3)
  })
  test('a failed coalesced read is retried by the next request', async () => {
    findOne.mockRejectedValueOnce(new Error('temporary catalog failure'))
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => getFirestoreApplicationContext('talio_company_first')))
    expect(results.every(result => result.status === 'rejected')).toBe(true)
    expect(findOne).toHaveBeenCalledTimes(1)
    expect((await getFirestoreApplicationContext('talio_company_first')).provider).toBe('mongodb')
    expect(findOne).toHaveBeenCalledTimes(2)
  })
  test('production still requires cutover after parity, including cached config', async () => {
    catalog.applicationCutover = false
    await getFirestoreApplicationContext('talio_company_first')
    process.env.NODE_ENV = 'production'
    await expect(getFirestoreApplicationContext('talio_company_first')).rejects.toThrow('live cutover verification')
  })
  test('explicit Mongo database and dataset are required with no source fallback', async () => {
    delete process.env.MONGODB_DATABASE
    await expect(getFirestoreApplicationContext('talio_company_first')).rejects.toThrow('MONGODB_DATABASE')
    process.env.MONGODB_DATABASE = 'talio'
    delete process.env.MONGODB_DATASET
    await expect(getFirestoreApplicationContext('talio_company_first')).rejects.toThrow('MONGODB_DATASET')
    expect(getTalioFirestore).not.toHaveBeenCalled()
  })
  test('Mongo is the default and an explicitly configured Firestore provider is rejected', async () => {
    delete process.env.TALIO_DATABASE_PROVIDER
    expect((await getFirestoreApplicationContext('talio_company_first')).provider).toBe('mongodb')
    process.env.TALIO_DATABASE_PROVIDER = 'firestore'
    await expect(getFirestoreApplicationContext('talio_company_first')).rejects.toThrow('only application database provider')
    expect(getTalioFirestore).not.toHaveBeenCalled()
  })
})
