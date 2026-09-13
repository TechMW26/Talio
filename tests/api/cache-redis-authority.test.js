const mockRedisClient = {
  isReady: false,
  on: jest.fn(),
  connect: jest.fn(async function connect() {
    this.isReady = true
  }),
  get: jest.fn(),
  set: jest.fn().mockResolvedValue('OK'),
  ping: jest.fn().mockResolvedValue('PONG'),
}

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient),
}))

jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue(new Headers()),
}))

describe('distributed cache authority', () => {
  const previousRedisUrl = process.env.REDIS_URL
  const previousRedisCa = process.env.REDIS_CA_CERT_BASE64
  let cache

  beforeAll(async () => {
    process.env.REDIS_URL = 'rediss://cache.example.test:6380'
    process.env.REDIS_CA_CERT_BASE64 = Buffer.from('test-redis-cloud-ca').toString('base64')
    delete global.__redisClient
    delete global.__redisClientPromise
    delete global.__redisConnectionFailed
    delete global.__redisErrorLogged
    delete global.__redisFailedAt
    cache = await import('@/lib/cache.js')
  })

  afterAll(() => {
    if (previousRedisUrl === undefined) delete process.env.REDIS_URL
    else process.env.REDIS_URL = previousRedisUrl
    if (previousRedisCa === undefined) delete process.env.REDIS_CA_CERT_BASE64
    else process.env.REDIS_CA_CERT_BASE64 = previousRedisCa
  })

  test('verifies TLS with the configured Redis Cloud certificate authority', async () => {
    const { createClient } = await import('redis')
    await cache.setCache('tls-config-probe', { ok: true }, 60)

    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      url: 'rediss://cache.example.test:6380',
      socket: expect.objectContaining({
        tls: true,
        ca: 'test-redis-cloud-ca',
        rejectUnauthorized: true,
      }),
    }))
  })

  test('does not resurrect stale process memory after an authoritative Redis miss', async () => {
    await cache.setCache('shared-key', { stale: true }, 60)
    global.__l1Cache.clear()
    global.__l1CacheTtls.clear()
    mockRedisClient.get.mockResolvedValueOnce(null)

    await expect(cache.getCache('shared-key')).resolves.toBeNull()
  })

  test('allows an internal health probe to ignore caller cache-bypass headers', async () => {
    const { headers } = await import('next/headers')
    headers.mockResolvedValueOnce(new Headers({ 'cache-control': 'no-store' }))
    mockRedisClient.get.mockResolvedValueOnce(JSON.stringify({ ok: true }))

    await expect(
      cache.getCache('redis-health-probe', { respectRequestBypass: false })
    ).resolves.toEqual({ ok: true })
  })

  test('health probes reach Redis regardless of request cache policy', async () => {
    const { headers } = await import('next/headers')
    headers.mockResolvedValue(new Headers({ 'cache-control': 'no-store' }))
    await expect(cache.probeRedis()).resolves.toBe(true)
    expect(mockRedisClient.ping).toHaveBeenCalledTimes(1)
  })

  test('health probes cannot mask an unavailable Redis behind warm memory', async () => {
    mockRedisClient.ping.mockRejectedValueOnce(new Error('connection lost'))
    await expect(cache.probeRedis()).resolves.toBe(false)
  })
})
