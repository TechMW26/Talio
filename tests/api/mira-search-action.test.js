jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn(), verifyTokenFromRequest: jest.fn() }))
jest.mock('@/lib/permissions', () => ({ requirePermission: jest.fn() }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn() }))
jest.mock('@/lib/miraInternet', () => ({ ...jest.requireActual('@/lib/miraInternet'), getMiraInternetContext: jest.fn() }))
import { getAuthAndDatabase } from '@/lib/auth'
import { requirePermission } from '@/lib/permissions'
import { rateLimit } from '@/lib/security/rateLimiter'
import { getMiraInternetContext } from '@/lib/miraInternet'
import { validateMiraAction } from '@/lib/miraActions'
import { POST } from '@/app/api/ai/mira-actions/route'

const query = 'NASA Artemis mission'
const action = { type: 'search_internet', fields: { query } }
const input = body => new Request('https://app.talio.in/api/ai/mira-actions', { method: 'POST', body: JSON.stringify({ action, ...body }) })
beforeEach(() => {
  jest.clearAllMocks()
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'user-A' }, tenant: { databaseName: 'tenant-A' }, database: {} })
  rateLimit.mockResolvedValue({ allowed: true })
  getMiraInternetContext.mockResolvedValue({ retrievedAt: '2026-10-28T12:00:00Z', results: [
    { title: 'NASA Artemis', snippet: 'NASA Artemis is the agency’s lunar exploration program.', url: 'https://www.nasa.gov/artemis/' },
  ] })
})

test('registered search action preserves only a short public query', () => {
  expect(validateMiraAction({ type: 'search_internet', fields: { query, privateContext: 'do not export', userId: 'other', url: 'https://attacker.test' } })).toEqual({ action })
  expect(validateMiraAction({ type: 'search_internet', fields: { query: 'x'.repeat(401) } }).error).toBeTruthy()
  expect(validateMiraAction({ type: 'search_internet', fields: {} }).error).toContain('query')
})
test.each(['My upcoming meetings', 'search my previous chats', 'Employee salary details', 'https://example.org/?token=private', 'user@example.com'])('blocks private search input before provider calls: %s', async value => {
  const result = await POST(input({ action: { type: 'search_internet', fields: { query: value } } }))
  expect(result.status).toBe(400)
  expect(getMiraInternetContext).not.toHaveBeenCalled()
})
test.each([401, 403])('authentication and current Mira access denial block search: %s', async status => {
  getAuthAndDatabase.mockResolvedValue({ success: false, status, message: 'Access denied' })
  expect((await POST(input())).status).toBe(status)
  expect(getMiraInternetContext).not.toHaveBeenCalled()
})
test('read-only orchestration step returns real evidence without requiring a write confirmation', async () => {
  const request = input()
  const response = await POST(request)
  const body = await response.json()
  expect(response.status).toBe(200)
  expect(body.success).toBe(true)
  expect(body.message).toContain('NASA Artemis is the agency’s lunar exploration program.')
  expect(body.message).toContain('https://www.nasa.gov/artemis/')
  expect(body.message).toContain('untrusted reference data')
  expect(getMiraInternetContext).toHaveBeenCalledWith(`Search the web for ${query}`, {}, '', { signal: request.signal })
  expect(rateLimit).toHaveBeenCalledWith('MIRA_AGENT_SEARCH', 'tenant-A:user-A')
  expect(requirePermission).not.toHaveBeenCalled()
  expect(response.headers.get('cache-control')).toBe('no-store')
})
test('rate limits are isolated per tenant and user', async () => {
  rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 17 })
  const response = await POST(input())
  expect(response.status).toBe(429)
  expect(response.headers.get('retry-after')).toBe('17')
  expect(getMiraInternetContext).not.toHaveBeenCalled()
})
test('bounds factual history to three complete safe sources and 1800 characters', async () => {
  getMiraInternetContext.mockResolvedValue({ results: Array.from({ length: 10 }, (_, index) => ({ title: '<b>' + 'A'.repeat(300) + '</b>', snippet: '<script>' + 'B'.repeat(3000) + '</script>', url: `https://example.org/${index}/${'c'.repeat(200)}` })) })
  const body = await (await POST(input())).json()
  expect(body.success).toBe(true)
  expect(body.sources).toHaveLength(3)
  expect(body.message.length).toBeLessThanOrEqual(1800)
  expect(body.message).not.toContain('<script>')
  for (const source of body.sources) expect(body.message).toContain(source.url)
})
test('unsafe, empty, duplicate and unavailable sources cannot falsely complete a prerequisite', async () => {
  getMiraInternetContext.mockResolvedValueOnce({ results: [
    { title: 'Unsafe', snippet: 'Not evidence', url: 'javascript:alert(1)' },
    { title: 'Private', snippet: 'Not evidence', url: 'http://localhost/private' },
    { title: 'Missing text', url: 'https://example.org' },
  ] })
  const response = await POST(input())
  expect(response.status).toBe(502)
  expect((await response.json()).success).toBe(false)
  getMiraInternetContext.mockResolvedValueOnce({ unavailable: 'Search deadline exhausted', results: [] })
  expect((await POST(input())).status).toBe(502)
})
test('provider failures hide internal details and never claim success', async () => {
  getMiraInternetContext.mockRejectedValue(new Error('private provider diagnostic'))
  const response = await POST(input())
  expect(response.status).toBe(502)
  expect(await response.text()).not.toContain('private provider diagnostic')
})
test('request abort cancels the prerequisite through its real signal', async () => {
  const controller = new AbortController()
  const request = new Request('https://app.talio.in/api/ai/mira-actions', { method: 'POST', signal: controller.signal, body: JSON.stringify({ action }) })
  getMiraInternetContext.mockImplementation(async (_message, _screen, _previous, options) => {
    controller.abort()
    options.signal.throwIfAborted()
  })
  const response = await POST(request)
  expect(response.status).toBe(499)
  expect((await response.json()).success).toBe(false)
})
