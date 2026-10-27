jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/miraVoiceAgent.server', () => ({ verifyMiraBridgeCredential: jest.fn() }))
jest.mock('@/lib/miraChatStore.server', () => ({ MIRA_CHAT_STORE_OPTIONS: {}, miraMonth: () => '2026-10', checkAndDeductMiraToken: jest.fn(), hasMiraVoiceReceipt: jest.fn() }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn(async () => ({ allowed: true })) }))
jest.mock('@/lib/miraWebSearch', () => ({ searchMiraInternet: jest.fn() }))
import { POST } from '@/app/api/ai/mira-agent/search/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { verifyMiraBridgeCredential } from '@/lib/miraVoiceAgent.server'
import { checkAndDeductMiraToken, hasMiraVoiceReceipt } from '@/lib/miraChatStore.server'
import { searchMiraInternet } from '@/lib/miraWebSearch'
beforeEach(() => {
  jest.clearAllMocks()
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'user', tokenId: 'session', authVersion: 2 }, tenant: { databaseName: 'tenant' }, database: {} })
  verifyMiraBridgeCredential.mockResolvedValue({ userId: 'user', databaseName: 'tenant', tokenId: 'session', authVersion: 2 })
  checkAndDeductMiraToken.mockResolvedValue({ allowed: true })
  searchMiraInternet.mockResolvedValue({ results: [{ title: 'Algaetree', url: 'https://algaetree.com' }] })
})
const request = overrides => new Request('https://app.talio.in/api/ai/mira-agent/search', { method: 'POST', body: JSON.stringify({ bridgeCredential: 'call', turn: 1, message: 'Algaetree', ...overrides }) })
test('voice internet lookup uses public utterance only and normalizes spelling', async () => {
  const response = await POST(request({ message: 'A-L-G-A-E-T-R-Double-E', context: 'private workplace record' }))
  expect(response.status).toBe(200)
  expect(searchMiraInternet).toHaveBeenCalledWith('ALGAETREE', { signal: expect.any(AbortSignal) })
  expect(checkAndDeductMiraToken).toHaveBeenCalledWith({}, 'user', '2026-10', expect.stringMatching(/^[a-f0-9]{64}$/))
})
test.each([{ userId: 'other' }, { databaseName: 'other' }, { tokenId: 'revoked' }, { authVersion: 1 }])('voice search protects the call identity: %s', async override => {
  verifyMiraBridgeCredential.mockResolvedValue({ userId: 'user', databaseName: 'tenant', tokenId: 'session', authVersion: 2, ...override })
  expect((await POST(request())).status).toBe(403)
  expect(searchMiraInternet).not.toHaveBeenCalled()
})
test.each(['Search my tasks', 'Employee salary details', 'My password is private', 'user@example.com'])('private queries never reach public search: %s', async message => {
  expect((await POST(request({ message }))).status).toBe(400)
  expect(searchMiraInternet).not.toHaveBeenCalled()
})
test('feature denial and exhausted quota prevent lookup', async () => {
  getAuthAndDatabase.mockResolvedValueOnce({ success: false, status: 403 })
  expect((await POST(request())).status).toBe(403)
  checkAndDeductMiraToken.mockResolvedValue({ allowed: false })
  expect((await POST(request())).status).toBe(429)
  expect(searchMiraInternet).not.toHaveBeenCalled()
})
test('DeepSeek calls require an existing paid utterance and reuse it for public search', async () => {
  verifyMiraBridgeCredential.mockResolvedValue({ userId: 'user', databaseName: 'tenant', tokenId: 'session', authVersion: 2, accounting: 'gateway', jti: 'owned-call' })
  hasMiraVoiceReceipt.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  expect((await POST(request())).status).toBe(429)
  expect(searchMiraInternet).not.toHaveBeenCalled()
  expect((await POST(request())).status).toBe(200)
  expect(checkAndDeductMiraToken).not.toHaveBeenCalled()
  expect(hasMiraVoiceReceipt).toHaveBeenCalledWith({}, 'user', 'owned-call', 'Algaetree')
})
