import { rateLimit, _resetRateLimiter } from '@/lib/security/rateLimiter'
import { consumeDistributedRateLimit } from '@/lib/cache'
jest.mock('@/lib/cache', () => ({ consumeDistributedRateLimit: jest.fn() }))
jest.mock('@/lib/security/auditLog', () => ({ recordSecurityEvent: jest.fn() }))
beforeEach(() => { jest.clearAllMocks(); _resetRateLimiter() })
test('enforces the shared count across instances', async () => {
  consumeDistributedRateLimit.mockResolvedValue({ count: 11, ttlMs: 4500 })
  expect(await rateLimit('AUTH_LOGIN', 'a')).toMatchObject({ allowed: false, retryAfterSeconds: 5, remaining: 0 })
})
test('uses bounded fallback protection when Redis is unavailable', async () => {
  consumeDistributedRateLimit.mockResolvedValue(null)
  for (let n = 0; n < 10; n++) expect((await rateLimit('AUTH_LOGIN', 'a')).allowed).toBe(true)
  for (let n = 0; n < 30; n++) expect(await rateLimit('AUTH_LOGIN', 'a')).toMatchObject({ allowed: false, hits: 11 })
  expect((await rateLimit('AUTH_LOGIN', 'b')).allowed).toBe(true)
})
