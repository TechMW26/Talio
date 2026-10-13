jest.mock('next/server', () => ({ NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), options) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/miraVoiceAgent.server', () => ({ MIRA_AGENT_LANGUAGES: ['en', 'hi'], verifyMiraBridgeCredential: jest.fn(), miraBridgeAuthRequest: jest.fn() }))
jest.mock('@/lib/miraChatStore.server', () => ({ MIRA_CHAT_STORE_OPTIONS: {}, miraMonth: () => '2026-10', checkAndDeductMiraToken: jest.fn(async () => ({ allowed: true })) }))
jest.mock('@/lib/miraAgentGateway', () => ({ ...jest.requireActual('@/lib/miraAgentGateway'), streamMiraAgentDeepSeek: jest.fn(async () => new Response('data: [DONE]\n\n').body) }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn() }))
import { getAuthAndDatabase } from '@/lib/auth'
import { verifyMiraBridgeCredential, miraBridgeAuthRequest } from '@/lib/miraVoiceAgent.server'
import { rateLimit } from '@/lib/security/rateLimiter'
import { streamMiraAgentDeepSeek } from '@/lib/miraAgentGateway'
import { checkAndDeductMiraToken } from '@/lib/miraChatStore.server'
import { POST } from '@/app/api/ai/mira-agent/llm/route'
import { POST as compatiblePOST } from '@/app/api/ai/mira-agent/llm/chat/completions/route'

const request = body => new Request('https://app.talio.in/api/ai/mira-agent/llm', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => {
  jest.clearAllMocks()
  verifyMiraBridgeCredential.mockImplementation(async token => { if (token !== 'scoped') throw new Error('Invalid'); return { databaseName: 'tenant', userId: 'user' } })
  miraBridgeAuthRequest.mockResolvedValue(new Request('https://app.talio.in/api/ai/mira-agent/llm'))
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'user', miraLanguage: 'hi' }, database: { get: jest.fn(), mutate: jest.fn() } })
  checkAndDeductMiraToken.mockResolvedValue({ allowed: true })
  rateLimit.mockResolvedValue({ allowed: true })
})
test('accepts the real ElevenLabs extra-body envelope and emits SSE', async () => {
  const response = await POST(request({ elevenlabs_extra_body: { mira_bridge_credential: 'scoped' }, messages: [{ role: 'user', content: 'Hello Mira' }] }))
  expect(response.status).toBe(200)
  expect(response.headers.get('server-timing')).toMatch(/voice_auth;dur=\d+, voice_model;dur=\d+/)
  expect(verifyMiraBridgeCredential).toHaveBeenCalledWith('scoped')
  expect(await response.text()).toContain('[DONE]')
  expect(streamMiraAgentDeepSeek).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ language: 'hi' }))
})
test('the provider-appended OpenAI endpoint uses exactly the same secured handler', () => {
  expect(compatiblePOST).toBe(POST)
})
test('uses only signed caller context and makes no employee/company lookup per reply', async () => {
  const userContext = { name: 'Asha', company: 'Example', gender: 'female' }
  verifyMiraBridgeCredential.mockResolvedValue({ databaseName: 'tenant', userId: 'user', userContext })
  const response = await POST(request({ mira_bridge_credential: 'scoped', userContext: { name: 'Spoof' }, messages: [{ role: 'user', content: 'What is my name?' }] }))
  expect(response.status).toBe(200)
  expect(streamMiraAgentDeepSeek).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ userContext }))
  const auth = await getAuthAndDatabase.mock.results[0].value
  expect(auth.database.get).not.toHaveBeenCalled()
})
test('rejects unsigned callback requests before database or rate-limit work', async () => {
  const response = await POST(request({ elevenlabs_extra_body: {}, messages: [] }))
  expect(response.status).toBe(401)
  expect(getAuthAndDatabase).not.toHaveBeenCalled()
  expect(rateLimit).not.toHaveBeenCalled()
})
test('rechecks current Mira permissions and does not grant access from a valid signature alone', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: false, status: 403, message: 'Mira disabled' })
  expect((await POST(request({ elevenlabs_extra_body: { mira_bridge_credential: 'scoped' }, messages: [{ role: 'user', content: 'Hi' }] }))).status).toBe(403)
})
test('an exhausted account cannot generate a voice response', async () => {
  checkAndDeductMiraToken.mockResolvedValue({ allowed: false })
  expect((await POST(request({ mira_bridge_credential: 'scoped', messages: [{ role: 'user', content: 'Hi' }] }))).status).toBe(429)
  expect(streamMiraAgentDeepSeek).not.toHaveBeenCalled()
})
test('only supported language changes update the current account without replacing other preferences', async () => {
  await POST(request({ mira_bridge_credential: 'scoped', messages: [{ role: 'user', content: 'Hola' }] }))
  const { onLanguage } = streamMiraAgentDeepSeek.mock.calls[0][1]
  const auth = await getAuthAndDatabase.mock.results[0].value
  await onLanguage('hi'); await onLanguage('invalid'); await onLanguage('es')
  expect(auth.database.mutate).not.toHaveBeenCalled()
  await onLanguage('en')
  expect(auth.database.mutate).toHaveBeenCalledWith('users', 'user', expect.any(Function))
  const updated = auth.database.mutate.mock.calls[0][2]({ miraPreferences: { voiceId: 'chosen', lastLanguage: 'hi' } })
  expect(updated.miraPreferences).toEqual({ voiceId: 'chosen', lastLanguage: 'en' })
})
test('legacy saved third languages safely fall back to English', async () => {
  const auth = await getAuthAndDatabase()
  auth.user.miraLanguage = 'it'
  await POST(request({ mira_bridge_credential: 'scoped', messages: [{ role: 'user', content: 'Hello' }] }))
  expect(streamMiraAgentDeepSeek).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ language: 'en' }))
})
