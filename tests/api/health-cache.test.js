jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('mongoose', () => ({ __esModule: true, default: { connection: {
  readyState: 1, db: { admin: () => ({ ping: jest.fn().mockResolvedValue() }) },
} } }))
jest.mock('@/lib/mongodb', () => ({ __esModule: true, default: jest.fn().mockResolvedValue() }))
jest.mock('@/lib/platform/runtime', () => ({
  getRuntimeCapabilities: () => ({ runtime: 'vercel', isVercel: true, distributedCache: true }),
  getVercelReadiness: () => ({ ready: true, missing: [], invalid: [] }),
}))
jest.mock('@/lib/cache', () => ({ probeRedis: jest.fn(), getRedisInfo: jest.fn() }))
const { GET } = require('@/app/api/health/route')
const { probeRedis, getRedisInfo } = require('@/lib/cache')

beforeEach(() => {
  jest.clearAllMocks()
  probeRedis.mockResolvedValue(true)
  getRedisInfo.mockResolvedValue({ connected: true })
})

test('liveness does not call external cache services', async () => {
  expect((await GET(new Request('https://talio.test/api/health'))).status).toBe(200)
  expect(probeRedis).not.toHaveBeenCalled()
})

test('detailed health directly probes Redis, including no-store requests', async () => {
  const response = await GET(new Request('https://talio.test/api/health?detailed=true', { headers: { 'cache-control': 'no-store' } }))
  expect(await response.json()).toEqual(expect.objectContaining({ status: 'ok', cache: expect.objectContaining({ available: true }) }))
  expect(probeRedis).toHaveBeenCalledTimes(1)
})

test('a failed Redis probe reports degraded even with a connected client object', async () => {
  probeRedis.mockResolvedValue(false)
  const response = await GET(new Request('https://talio.test/api/health?detailed=true'))
  expect(await response.json()).toEqual(expect.objectContaining({ status: 'degraded', cache: expect.objectContaining({ available: false }) }))
})
