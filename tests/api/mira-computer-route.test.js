jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn() }))
jest.mock('@/lib/ai/aiProviderManager', () => ({ generateVisionContent: jest.fn() }))
import { POST } from '@/app/api/ai/mira-computer/route'
import { getAuthAndModels } from '@/lib/auth'
import { rateLimit } from '@/lib/security/rateLimiter'
import { generateVisionContent } from '@/lib/ai/aiProviderManager'
import sharp from 'sharp'
const request = value => new Request('http://localhost/api/ai/mira-computer', { method: 'POST', body: JSON.stringify(value) })
beforeEach(() => {
  jest.clearAllMocks()
  getAuthAndModels.mockResolvedValue({ success: true, tenant: { databaseName: 'tenant' }, user: { _id: 'u' } })
  rateLimit.mockResolvedValue({ allowed: true })
})
test('auth and tenant rate limits precede vision work', async () => {
  getAuthAndModels.mockResolvedValueOnce({ success: false })
  expect((await POST(request({}))).status).toBe(401)
  rateLimit.mockResolvedValueOnce({ allowed: false })
  expect((await POST(request({}))).status).toBe(429)
  expect(generateVisionContent).not.toHaveBeenCalled()
})
test('uses validated screenshot bytes and rejects shell actions', async () => {
  const image = (await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).jpeg().toBuffer()).toString('base64')
  generateVisionContent.mockResolvedValueOnce('{"action":{"type":"exec","command":"bad"}}')
  expect((await POST(request({ goal: 'Search Notes', image, history: [] }))).status).toBe(422)
  generateVisionContent.mockResolvedValueOnce('{"done":true,"message":"Notes is open."}')
  const result = await POST(request({ goal: 'Open Notes', app: 'Notes', image, history: [] }))
  expect(result.headers.get('cache-control')).toBe('no-store')
  expect(await result.json()).toEqual({ success: true, done: true, message: 'Notes is open.' })
})

test('opens WhatsApp without a model round trip but does not claim completion', async () => {
  const image = (await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).jpeg().toBuffer()).toString('base64')
  const result = await POST(request({ goal: 'Open WhatsApp', app: 'Talio', image, history: [] }))
  expect(await result.json()).toMatchObject({ success: true, action: { type: 'open_app', name: 'WhatsApp' } })
  expect(generateVisionContent).not.toHaveBeenCalled()
})

test('keeps ambiguous contact selection a question rather than a click', async () => {
  const image = (await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).jpeg().toBuffer()).toString('base64')
  generateVisionContent.mockResolvedValueOnce('```json\n{"question":"Which Mansi do you mean?"}\n```')
  const result = await POST(request({ goal: 'text Mansi hi on WhatsApp', app: 'WhatsApp', image, history: [] }))
  expect(await result.json()).toEqual({ success: true, question: 'Which Mansi do you mean?' })
})
