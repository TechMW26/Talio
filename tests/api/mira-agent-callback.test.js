jest.mock('next/server', () => ({ NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), options) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/miraVoiceAgent.server', () => ({ verifyMiraBridgeCredential: jest.fn(), miraBridgeAuthRequest: jest.fn() }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn() }))
import { getAuthAndDatabase } from '@/lib/auth'
import { verifyMiraBridgeCredential, miraBridgeAuthRequest } from '@/lib/miraVoiceAgent.server'
import { rateLimit } from '@/lib/security/rateLimiter'
import { POST } from '@/app/api/ai/mira-agent/llm/route'
import { POST as compatiblePOST } from '@/app/api/ai/mira-agent/llm/chat/completions/route'

const request = body => new Request('https://app.talio.in/api/ai/mira-agent/llm', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => {
  jest.clearAllMocks()
  verifyMiraBridgeCredential.mockImplementation(async token => { if (token !== 'scoped') throw new Error('Invalid'); return { databaseName: 'tenant', userId: 'user' } })
  miraBridgeAuthRequest.mockResolvedValue(new Request('https://app.talio.in/api/ai/mira-agent/llm'))
  getAuthAndDatabase.mockResolvedValue({ success: true })
  rateLimit.mockResolvedValue({ allowed: true })
})
test('accepts the real ElevenLabs extra-body envelope and emits SSE', async () => {
  const response = await POST(request({ elevenlabs_extra_body: { mira_bridge_credential: 'scoped' }, messages: [{ role: 'user', content: 'Hello Mira' }] }))
  expect(response.status).toBe(200)
  expect(verifyMiraBridgeCredential).toHaveBeenCalledWith('scoped')
  expect(await response.text()).toContain('ask_mira')
})
test('the provider-appended OpenAI endpoint uses exactly the same secured handler', () => {
  expect(compatiblePOST).toBe(POST)
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
