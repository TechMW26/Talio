jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/miraAccess.server', () => ({ getMiraSettings: jest.fn(async () => ({ agent: { agentId: 'owned-agent', promptHash: 'current' } })) }))
jest.mock('@/lib/miraVoiceAgent.server', () => ({ MIRA_AGENT_LANGUAGES: ['en', 'hi', 'es'], createMiraBridgeCredential: jest.fn(async () => 'scoped-bridge'), miraAgentPromptHash: () => 'current', elevenAgentRequest: jest.fn() }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn(async () => ({ allowed: true })) }))
jest.mock('@/lib/miraChatStore.server', () => ({ MIRA_CHAT_STORE_OPTIONS: {}, readMiraTokens: jest.fn(async () => ({ tokensRemaining: 100 })) }))
import { POST } from '@/app/api/ai/mira-agent/session/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { elevenAgentRequest } from '@/lib/miraVoiceAgent.server'
import { readMiraTokens } from '@/lib/miraChatStore.server'

beforeEach(() => {
  jest.clearAllMocks()
  readMiraTokens.mockResolvedValue({ tokensRemaining: 100 })
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'user' }, tenant: { databaseName: 'tenant' }, database: { get: jest.fn(async () => ({})) } })
  elevenAgentRequest.mockResolvedValue({ token: 'rtc-credential', signed_url: 'wss://legacy.example/private' })
})
const request = body => new Request('https://app.talio.in/api/ai/mira-agent/session', { method: 'POST', ...(body !== undefined ? { body } : {}) })
test('returns exactly one private WebRTC credential for the continuous voice call', async () => {
  const response = await POST(request(JSON.stringify({ transport: 'webrtc' })))
  const body = await response.json()
  expect(response.status).toBe(200)
  expect(body).toMatchObject({ conversationToken: 'rtc-credential', connectionType: 'webrtc', bridgeCredential: 'scoped-bridge' })
  expect(body.signedUrl).toBeUndefined()
  expect(elevenAgentRequest).toHaveBeenCalledTimes(1)
  expect(elevenAgentRequest).toHaveBeenCalledWith('/conversation/token?agent_id=owned-agent')
  expect(response.headers.get('cache-control')).toBe('no-store')
})
test('retains signed URLs only for existing clients, without making duplicate provider requests', async () => {
  const body = await (await POST(request())).json()
  expect(body).toMatchObject({ signedUrl: 'wss://legacy.example/private', connectionType: 'websocket' })
  expect(body.conversationToken).toBeUndefined()
  expect(elevenAgentRequest).toHaveBeenCalledTimes(1)
})
test.each(['broken json', '{"transport":"anything"}', 'null'])('rejects invalid call requests: %s', async body => {
  expect((await POST(request(body))).status).toBe(400)
  expect(elevenAgentRequest).not.toHaveBeenCalled()
})
test('denied access never creates provider credentials', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: false, status: 403, message: 'Disabled' })
  expect((await POST(request('{"transport":"webrtc"}'))).status).toBe(403)
  expect(elevenAgentRequest).not.toHaveBeenCalled()
})
test('exhausted allowance does not mint a native voice credential', async () => {
  readMiraTokens.mockResolvedValue({ tokensRemaining: 0 })
  expect((await POST(request('{"transport":"webrtc"}'))).status).toBe(429)
  expect(elevenAgentRequest).not.toHaveBeenCalled()
})
test('a new call resumes the language saved on the authenticated account', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'user' }, tenant: {}, database: { get: async () => ({ miraPreferences: { lastLanguage: 'hi' } }) } })
  expect(await (await POST(request('{"transport":"webrtc"}'))).json()).toMatchObject({ language: 'hi' })
})
