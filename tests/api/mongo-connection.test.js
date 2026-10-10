jest.mock('mongodb', () => ({ MongoClient: jest.fn() }))
import { MongoClient } from 'mongodb'
import { getTalioMongoClient, getTalioMongoDatabase } from '../../lib/platform/mongo.server'

beforeEach(() => {
  MongoClient.mockImplementation(() => {
    const client = { connect: jest.fn(async () => client), close: jest.fn(async () => {}), db: jest.fn(name => ({ databaseName: name })) }
    return client
  })
  MongoClient.mockClear()
})

test('concurrent requests share one bounded lazy native connection pool', async () => {
  const env = { MONGODB_URI: 'mongodb://localhost:27017/test-pool' }
  const [one, two] = await Promise.all([getTalioMongoClient(env), getTalioMongoClient(env)])
  expect(one).toBe(two)
  expect(MongoClient).toHaveBeenCalledTimes(1)
  expect(MongoClient.mock.calls[0][1]).toMatchObject({ maxPoolSize: 10, minPoolSize: 0, maxIdleTimeMS: 60000, promoteBuffers: true })
  expect(one.connect).toHaveBeenCalledTimes(1)
})

test('failed connections are not retained and can recover on the next request', async () => {
  MongoClient.mockImplementationOnce(() => ({ connect: jest.fn(async () => { throw new Error('unavailable') }), close: jest.fn(async () => {}) }))
  const env = { MONGODB_URI: 'mongodb://localhost:27017/test-retry' }
  await expect(getTalioMongoClient(env)).rejects.toThrow('unavailable')
  await expect(getTalioMongoClient(env)).resolves.toBeDefined()
  expect(MongoClient).toHaveBeenCalledTimes(2)
})

test('database and server credential configuration is explicitly validated', async () => {
  await expect(getTalioMongoClient({})).rejects.toThrow('MONGODB_URI')
  await expect(getTalioMongoDatabase({ MONGODB_URI: 'mongodb://localhost:27017/test-name' })).rejects.toThrow('Invalid MONGODB_DATABASE')
  await expect(getTalioMongoDatabase({ MONGODB_URI: 'mongodb://localhost:27017/test-name', MONGODB_DATABASE: '../invalid' })).rejects.toThrow('Invalid MONGODB_DATABASE')
  expect((await getTalioMongoDatabase({ MONGODB_URI: 'mongodb://localhost:27017/test-name', MONGODB_DATABASE: 'talio' })).databaseName).toBe('talio')
})
