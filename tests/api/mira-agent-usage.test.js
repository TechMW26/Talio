jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/miraVoiceAgent.server', () => ({ verifyMiraBridgeCredential: jest.fn() }))
jest.mock('@/lib/miraChatStore.server', () => ({ MIRA_CHAT_STORE_OPTIONS: {}, miraMonth: () => '2026-10', checkAndDeductMiraToken: jest.fn() }))
import { POST } from '@/app/api/ai/mira-agent/usage/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { verifyMiraBridgeCredential } from '@/lib/miraVoiceAgent.server'
import { checkAndDeductMiraToken } from '@/lib/miraChatStore.server'

beforeEach(() => {
  jest.clearAllMocks()
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'user', tokenId: 'session', authVersion: 2 }, tenant: { databaseName: 'tenant' }, database: {} })
  verifyMiraBridgeCredential.mockResolvedValue({ userId: 'user', databaseName: 'tenant', tokenId: 'session', authVersion: 2 })
  checkAndDeductMiraToken.mockResolvedValue({ allowed: true, tokensRemaining: 99 })
})
const request = body => new Request('https://app.talio.in/api/ai/mira-agent/usage', { method: 'POST', body: JSON.stringify(body) })
test('charges using authenticated identity and a deterministic retry key', async () => {
  const body = { bridgeCredential: 'private-call', turn: 1, userId: 'attacker' }
  expect((await POST(request(body))).status).toBe(200)
  expect((await POST(request(body))).status).toBe(200)
  const args = checkAndDeductMiraToken.mock.calls
  expect(args[0]).toEqual([{}, 'user', '2026-10', expect.stringMatching(/^[a-f0-9]{64}$/)])
  expect(args[1][3]).toBe(args[0][3])
})
test.each([{ userId: 'different' }, { databaseName: 'other-tenant' }, { tokenId: 'revoked' }, { authVersion: 1 }])('cannot account against another user, tenant or session: %s', async override => {
  verifyMiraBridgeCredential.mockResolvedValue({ userId: 'user', databaseName: 'tenant', tokenId: 'session', authVersion: 2, ...override })
  expect((await POST(request({ bridgeCredential: 'call', turn: 1 }))).status).toBe(403)
  expect(checkAndDeductMiraToken).not.toHaveBeenCalled()
})
test('denied feature access or exhausted balance is fail-closed', async () => {
  getAuthAndDatabase.mockResolvedValueOnce({ success: false, status: 403, message: 'Disabled' })
  expect((await POST(request({ bridgeCredential: 'call', turn: 1 }))).status).toBe(403)
  expect(verifyMiraBridgeCredential).not.toHaveBeenCalled()
  checkAndDeductMiraToken.mockResolvedValue({ allowed: false, tokensRemaining: 0 })
  expect((await POST(request({ bridgeCredential: 'call', turn: 1 }))).status).toBe(429)
})
