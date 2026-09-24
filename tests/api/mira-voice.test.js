jest.mock('next/server', () => ({ NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), options) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn() }))
import { getAuthAndModels } from '@/lib/auth'
import { rateLimit } from '@/lib/security/rateLimiter'
import { POST } from '@/app/api/ai/mira-voice/route'
import { POST as createToken } from '@/app/api/ai/mira-voice/token/route'

const originalFetch = global.fetch
beforeEach(() => {
  getAuthAndModels.mockResolvedValue({ success: true, user: { _id: 'u' }, tenant: { databaseName: 'tenantA' } })
  rateLimit.mockResolvedValue({ allowed: true })
  process.env.ELEVENLABS_API_KEY = 'test-key'
  process.env.ELEVENLABS_VOICE_ID = 'fixed-voice'
  global.fetch = jest.fn().mockResolvedValue(new Response(new Uint8Array([0, 0, 1, 0])))
})
afterAll(() => { global.fetch = originalFetch })
const run = body => POST(new Request('http://localhost/api/ai/mira-voice', { method: 'POST', body: JSON.stringify(body) }))
test('streams provider audio with server-only credentials and fixed voice', async () => {
  const response = await run({ text: 'Hello', voice: 'attacker', url: 'https://attacker.test' })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.arrayBuffer()).toHaveProperty('byteLength', 4)
  expect(global.fetch).toHaveBeenCalledWith('https://api.elevenlabs.io/v1/text-to-speech/fixed-voice/stream?output_format=pcm_24000', expect.objectContaining({ headers: expect.objectContaining({ 'xi-api-key': 'test-key' }) }))
  expect(rateLimit).toHaveBeenCalledWith('MIRA_VOICE', 'tenantA:u')
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({ model_id: 'eleven_v3_conversational', apply_text_normalization: 'on' })
})
test('rejects unauthenticated callers before generation', async () => {
  getAuthAndModels.mockResolvedValue({ success: false })
  expect((await run({ text: 'Hello' })).status).toBe(401)
  expect(global.fetch).not.toHaveBeenCalled()
})
test.each(['माझ्या बैठका दाखवा.', 'मेरो बैठक देखाउनुहोस्।', 'Bonjour.', 'こんにちは。', 'مرحبًا', 'Hello.'])('does not force a language from the script: %s', async text => {
  const response = await run({ text })
  expect(response.status).toBe(200)
  await response.arrayBuffer()
  const body = JSON.parse(global.fetch.mock.calls[0][1].body)
  expect(body.text).toBe(text)
  expect(body).not.toHaveProperty('language_code')
})
test.each([null, '', 'a'.repeat(5001), { $ne: '' }])('rejects invalid text', async text => {
  expect((await run({ text })).status).toBe(400)
  expect(global.fetch).not.toHaveBeenCalled()
})
test('enforces rate limits and hides provider error details', async () => {
  rateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 10 })
  expect((await run({ text: 'Hello' })).status).toBe(429)
  global.fetch.mockResolvedValueOnce(new Response('sensitive upstream error', { status: 401 }))
  const response = await run({ text: 'Hello' })
  expect(response.status).toBe(502)
  expect(await response.text()).not.toContain('sensitive')
})
test('speech chunks stream in order with bounded text per provider request', async () => {
  let sequence = 0
  global.fetch.mockImplementation(async () => new Response(new Uint8Array([++sequence, 0])))
  const response = await run({ text: 'A short sentence about today. '.repeat(20) })
  const bytes = new Uint8Array(await response.arrayBuffer())
  expect(bytes[0]).toBe(1)
  expect(bytes[2]).toBe(2)
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).text.length).toBeLessThanOrEqual(120)
  expect(global.fetch.mock.calls.every(([, opts]) => JSON.parse(opts.body).text.length <= 280)).toBe(true)
})
test('recognition token is authenticated and non-cacheable', async () => {
  global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ token: 'temporary' })))
  const response = await createToken(new Request('http://localhost/api/ai/mira-voice/token', { method: 'POST' }))
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({ token: 'temporary' })
  getAuthAndModels.mockResolvedValueOnce({ success: false })
  expect((await createToken(new Request('http://localhost/api/ai/mira-voice/token', { method: 'POST' }))).status).toBe(401)
})
