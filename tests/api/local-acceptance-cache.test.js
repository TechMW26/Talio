jest.mock('redis', () => ({ createClient: jest.fn() }))
jest.mock('next/headers', () => ({ headers: jest.fn(async () => new Headers()) }))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
import { createClient } from 'redis'
import { waitUntil } from '@vercel/functions'
import * as cache from '@/lib/cache'

describe('local migration acceptance cache isolation', () => {
  let previous, client
  beforeEach(() => {
    previous = { local: process.env.TALIO_LOCAL_ACCEPTANCE, database: process.env.MONGODB_DATABASE, dataset: process.env.MONGODB_DATASET, client: global.__redisClient }
    process.env.TALIO_LOCAL_ACCEPTANCE = '1'
    process.env.MONGODB_DATABASE = 'talio'
    process.env.MONGODB_DATASET = 'test-acceptance-a'
    client = { isReady: true, ...Object.fromEntries(['get', 'set', 'del', 'scan', 'eval', 'ping', 'info', 'flushDb'].map(key => [key, jest.fn()])) }
    global.__redisClient = client
    global.__l1Cache.set('shared-key', { source: 'production' })
    global.__l1CacheTtls.set('shared-key', Date.now() + 60000)
    jest.clearAllMocks()
  })
  afterEach(async () => {
    await cache.flushAllCaches()
    for (const [key, value] of [['TALIO_LOCAL_ACCEPTANCE', previous.local], ['MONGODB_DATABASE', previous.database], ['MONGODB_DATASET', previous.dataset]]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    global.__redisClient = previous.client
    global.__l1Cache.delete('shared-key'); global.__l1CacheTtls.delete('shared-key')
  })
  const expectNoRemoteCalls = () => {
    expect(createClient).not.toHaveBeenCalled()
    expect(waitUntil).not.toHaveBeenCalled()
    for (const value of Object.values(client)) if (typeof value === 'function') expect(value).not.toHaveBeenCalled()
  }
  test('read/write/delete/invalidation and diagnostics never use a configured warm Redis client', async () => {
    expect(await cache.getCache('shared-key')).toBeNull()
    await cache.setCache('shared-key', { source: 'local' })
    expect(await cache.getCache('shared-key')).toEqual({ source: 'local' })
    await cache.deleteCache('shared-key')
    await cache.setCache('temporary', 1)
    await cache.clearCachePattern('temp*')
    expect(await cache.getCache('temporary')).toBeNull()
    expect(await cache.consumeDistributedRateLimit('user@example.test', 60000)).toBeNull()
    expect(await cache.probeRedis()).toBe(false)
    expect(await cache.isRedisConnected()).toBe(false)
    expect(await cache.getRedisInfo()).toMatchObject({ type: 'memory', isolated: true, host: null, connected: false })
    cache.resetRedisConnection()
    expect(global.__redisClient).toBe(client)
    expect(await cache.flushAllCaches()).toBe(true)
    expect(global.__l1Cache.get('shared-key')).toEqual({ source: 'production' })
    expectNoRemoteCalls()
  })
  test('local datasets have independent keys and flushing one preserves the other', async () => {
    await cache.setCache('same-key', 'dataset-a')
    process.env.MONGODB_DATASET = 'test-acceptance-b'
    expect(await cache.getCache('same-key')).toBeNull()
    await cache.setCache('same-key', 'dataset-b')
    process.env.MONGODB_DATASET = 'test-acceptance-a'
    await cache.flushAllCaches()
    expect(await cache.getCache('same-key')).toBeNull()
    process.env.MONGODB_DATASET = 'test-acceptance-b'
    expect(await cache.getCache('same-key')).toBe('dataset-b')
    expectNoRemoteCalls()
  })
  test('local databases have independent keys even with the same dataset name', async () => {
    await cache.setCache('same-key', 'database-a')
    process.env.MONGODB_DATABASE = 'talio-test'
    expect(await cache.getCache('same-key')).toBeNull()
    await cache.setCache('same-key', 'database-b')
    process.env.MONGODB_DATABASE = 'talio'
    await cache.flushAllCaches()
    process.env.MONGODB_DATABASE = 'talio-test'
    expect(await cache.getCache('same-key')).toBe('database-b')
    expectNoRemoteCalls()
  })
})
