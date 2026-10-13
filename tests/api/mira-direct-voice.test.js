jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/miraVoiceAgent.server', () => ({ createMiraBridgeCredential: jest.fn(async () => 'signed-context'), verifyMiraBridgeCredential: jest.fn() }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn() }))
jest.mock('@/lib/miraChatStore.server', () => ({ MIRA_CHAT_STORE_OPTIONS: {}, readMiraTokens: jest.fn(), checkAndDeductMiraToken: jest.fn(), miraMonth: () => '2026-10' }))
jest.mock('@/lib/miraAgentGateway', () => ({ ...jest.requireActual('@/lib/miraAgentGateway'), streamMiraAgentDeepSeek: jest.fn() }))
import { getAuthAndDatabase } from '@/lib/auth'
import { createMiraBridgeCredential, verifyMiraBridgeCredential } from '@/lib/miraVoiceAgent.server'
import { rateLimit } from '@/lib/security/rateLimiter'
import { readMiraTokens, checkAndDeductMiraToken } from '@/lib/miraChatStore.server'
import { streamMiraAgentDeepSeek } from '@/lib/miraAgentGateway'
import { POST as session } from '@/app/api/ai/mira-voice/session/route'
import { POST as reply } from '@/app/api/ai/mira-voice/reply/route'

const user = { _id: 'u', tokenId: 'login', authVersion: 2, miraLanguage: 'en', employeeId: 'e' }
const tenant = { databaseName: 'tenant' }
const context = { name: 'Asha Rao', company: 'Example', gender: 'female' }
const database = { get: jest.fn(), mutate: jest.fn() }
const balance = { tokensUsed: 1, tokenLimit: 100, tokensRemaining: 99 }
const request = body => new Request('http://localhost/api/ai/mira-voice/reply', { method: 'POST', body: JSON.stringify(body) })
const input = { bridgeCredential: 'signed-context', turn: 1, messages: [{ role: 'user', content: 'Hello Mira' }] }
beforeEach(() => {
  jest.clearAllMocks()
  process.env.DEEPSEEK_API_KEY = process.env.ELEVENLABS_API_KEY = 'test-only'
  getAuthAndDatabase.mockResolvedValue({ success: true, user, tenant, database })
  database.get.mockImplementation(async collection => ({ users: { miraPreferences: { voiceId: '6JsmTroalVewG1gA6Jmw' }, company: 'c' }, employees: { firstName: 'Asha', lastName: 'Rao', gender: 'female', company: 'c' }, companies: { name: 'Example' } })[collection])
  rateLimit.mockResolvedValue({ allowed: true })
  readMiraTokens.mockResolvedValue(balance)
  checkAndDeductMiraToken.mockResolvedValue({ allowed: true, ...balance })
  verifyMiraBridgeCredential.mockResolvedValue({ userId: 'u', databaseName: 'tenant', tokenId: 'login', authVersion: 2, jti: 'call', userContext: context })
  streamMiraAgentDeepSeek.mockImplementation(async () => new ReadableStream({ start(c) { c.close() } }))
})
test('session signs only authenticated basic context and saved voice without an agent request', async () => {
  const response = await session(request({ userContext: { name: 'Spoof' } }))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ bridgeCredential: 'signed-context', voiceId: '6JsmTroalVewG1gA6Jmw', renewAfterMs: 540000 })
  expect(createMiraBridgeCredential).toHaveBeenCalledWith(user, tenant, context)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
})
test('ordinary reply reuses signed context, bounds tools and does not fetch the profile again', async () => {
  const response = await reply(request({ ...input, tools: [{ name: 'delete_everything' }], userContext: { name: 'Spoof' } }))
  expect(response.status).toBe(200)
  expect(streamMiraAgentDeepSeek).toHaveBeenCalledWith(expect.objectContaining({ tools: expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: 'ask_mira' }) })]) }), expect.objectContaining({ direct: true, userContext: context, language: 'en' }))
  expect(database.get).not.toHaveBeenCalled()
  expect(database.mutate).not.toHaveBeenCalled()
  expect(JSON.parse(response.headers.get('X-Mira-Balance'))).toEqual(balance)
})
test.each(['userId', 'databaseName', 'tokenId', 'authVersion'])('rejects mismatched %s before billing or generation', async key => {
  verifyMiraBridgeCredential.mockResolvedValue({ userId: 'u', databaseName: 'tenant', tokenId: 'login', authVersion: 2, [key]: 'different' })
  expect((await reply(request(input))).status).toBe(403)
  expect(checkAndDeductMiraToken).not.toHaveBeenCalled()
  expect(streamMiraAgentDeepSeek).not.toHaveBeenCalled()
})
test('rejects revoked access, expired sessions and exhausted allowance', async () => {
  getAuthAndDatabase.mockResolvedValueOnce({ success: false, status: 403 })
  expect((await reply(request(input))).status).toBe(403)
  verifyMiraBridgeCredential.mockRejectedValueOnce(new Error('expired credential'))
  expect((await reply(request(input))).status).toBe(401)
  checkAndDeductMiraToken.mockResolvedValueOnce({ allowed: false })
  expect((await reply(request(input))).status).toBe(429)
  expect(streamMiraAgentDeepSeek).not.toHaveBeenCalled()
})
test('Hindi switches persist only when changed and control the same turn pronunciation', async () => {
  const response = await reply(request({ ...input, messages: [{ role: 'user', content: 'हाँ मीरा तुम कैसी हो?' }] }))
  expect(response.headers.get('X-Mira-Language')).toBe('hi')
  const saved = database.mutate.mock.calls[0][2]({ miraPreferences: { voiceId: 'chosen' } })
  expect(saved.miraPreferences).toEqual({ voiceId: 'chosen', lastLanguage: 'hi' })
})
test('a tool continuation deduplicates billing and cannot dispatch a second action', async () => {
  await reply(request(input))
  const toolCall = { id: 'action', type: 'function', function: { name: 'ask_mira', arguments: '{}' } }
  await reply(request({ ...input, messages: [...input.messages, { role: 'assistant', content: '', tool_calls: [toolCall] }, { role: 'tool', tool_call_id: 'action', content: '{"success":true}' }] }))
  expect(checkAndDeductMiraToken.mock.calls[0][3]).toBe(checkAndDeductMiraToken.mock.calls[1][3])
  expect(streamMiraAgentDeepSeek.mock.calls[1][0].tools).toEqual([])
})
test('invalid and oversized input never reaches generation; provider failures are not client errors', async () => {
  expect((await reply(request({ ...input, turn: -1 }))).status).toBe(400)
  expect((await reply(request({ ...input, messages: [{ role: 'user', content: 'x'.repeat(49000) }] }))).status).toBe(413)
  expect(streamMiraAgentDeepSeek).not.toHaveBeenCalled()
  streamMiraAgentDeepSeek.mockRejectedValueOnce(new Error('private provider error'))
  const response = await reply(request(input))
  expect(response.status).toBe(502)
  expect(await response.text()).not.toContain('private')
})
