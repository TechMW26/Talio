jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn(), buildRateLimitHeaders: () => ({ 'Retry-After': '10' }) }))
jest.mock('@/lib/ai/miraHybridDesktop', () => ({ validateHybridRequest: jest.fn(body => body), requestHybridDesktop: jest.fn() }))
import { POST } from '@/app/api/ai/mira-desktop-plan/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { rateLimit } from '@/lib/security/rateLimiter'
import { requestHybridDesktop, validateHybridRequest } from '@/lib/ai/miraHybridDesktop'
const req = body => new Request('http://localhost/api/ai/mira-desktop-plan', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => {
  jest.clearAllMocks()
  getAuthAndDatabase.mockResolvedValue({ success: true, tenant: { databaseName: 'tenant' }, user: { _id: 'user' } })
  rateLimit.mockResolvedValue({ allowed: true }); requestHybridDesktop.mockResolvedValue({ success: true, fallback: true })
})
test('authentication and revocation precede provider calls', async () => {
  getAuthAndDatabase.mockResolvedValueOnce({ success: false, status: 403 })
  expect((await POST(req({}))).status).toBe(403); expect(requestHybridDesktop).not.toHaveBeenCalled()
})
test('tenant budget includes Retry-After and stops before provider', async () => {
  rateLimit.mockResolvedValueOnce({ allowed: false })
  const r = await POST(req({})); expect(r.status).toBe(429); expect(r.headers.get('retry-after')).toBe('10'); expect(requestHybridDesktop).not.toHaveBeenCalled()
})
test('bounded body, tenant binding, no-store and safe provider fallback', async () => {
  expect((await POST(req({ data: 'x'.repeat(49000) }))).status).toBe(413)
  validateHybridRequest.mockImplementationOnce(() => { throw new Error('bad') })
  expect((await POST(req({}))).status).toBe(400)
  const r = await POST(req({ operation: 'plan' }))
  expect(r.headers.get('cache-control')).toBe('no-store')
  expect(requestHybridDesktop).toHaveBeenCalledWith({ operation: 'plan' }, 'tenant:user', expect.anything())
  requestHybridDesktop.mockRejectedValueOnce(new Error('secret upstream error'))
  expect(await (await POST(req({}))).json()).toEqual({ success: true, fallback: true, reason: 'planner_unavailable' })
})
