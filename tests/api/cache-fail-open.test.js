const mockRedisClient = {
  isReady: false,
  on: jest.fn(),
  connect: jest.fn(() => new Promise(() => {})),
  get: jest.fn(),
  set: jest.fn(),
}

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient),
}))

jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue(new Headers()),
}))

describe('remote cache latency boundary', () => {
  const previousRedisUrl = process.env.REDIS_URL
  let cache

  beforeAll(async () => {
    jest.useFakeTimers()
    process.env.REDIS_URL = 'redis://slow.example.test:6379'
    delete global.__redisClient
    delete global.__redisClientPromise
    delete global.__redisConnectionFailed
    delete global.__redisErrorLogged
    delete global.__redisFailedAt
    cache = await import('@/lib/cache.js')
  })

  afterAll(() => {
    jest.useRealTimers()
    if (previousRedisUrl === undefined) delete process.env.REDIS_URL
    else process.env.REDIS_URL = previousRedisUrl
  })

  test('falls back instead of waiting indefinitely for Redis to connect', async () => {
    const resultPromise = cache.getCache('cold-key')
    await jest.advanceTimersByTimeAsync(751)

    await expect(resultPromise).resolves.toBeNull()
    expect(mockRedisClient.connect).toHaveBeenCalledTimes(1)
  })

  test('uses the cooldown after a timeout instead of paying the delay per request', async () => {
    const resultPromise = cache.getCache('another-cold-key')
    await expect(resultPromise).resolves.toBeNull()
    expect(mockRedisClient.connect).toHaveBeenCalledTimes(1)
  })
})
