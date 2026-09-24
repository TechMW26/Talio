jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn() }))
jest.mock('@/lib/ai/aiProviderManager', () => ({ generateContent: jest.fn(), generateVisionContent: jest.fn() }))
import { getAuthAndModels } from '@/lib/auth'
import { rateLimit } from '@/lib/security/rateLimiter'
import { generateContent, generateVisionContent } from '@/lib/ai/aiProviderManager'
import { POST } from '@/app/api/ai/mira-navigation-snapshot/route'
import sharp from 'sharp'
const payload = { target: 'टास्क', page: '/dashboard/projects/123', controls: [{ id: '0', label: 'Tasks', role: 'tab', bounds: { x: 0, y: 0, width: 100, height: 30 } }] }
const request = body => new Request('http://localhost/api/ai/mira-navigation-snapshot', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => {
  jest.clearAllMocks()
  getAuthAndModels.mockResolvedValue({ success: true, tenant: { databaseName: 'tenant' }, user: { _id: 'user' } })
  rateLimit.mockResolvedValue({ allowed: true })
  generateContent.mockResolvedValue('{"controlId":"0"}')
  generateVisionContent.mockResolvedValue('{"controlId":"0"}')
})
test('requires authentication and tenant-scoped rate limits', async () => {
  getAuthAndModels.mockResolvedValueOnce({ success: false })
  expect((await POST(request(payload))).status).toBe(401)
  rateLimit.mockResolvedValueOnce({ allowed: false })
  expect((await POST(request(payload))).status).toBe(429)
  expect(rateLimit).toHaveBeenCalledWith('MIRA_ATTACHMENT', 'tenant:user')
  expect(generateContent).not.toHaveBeenCalled()
})
test('resolves a DOM snapshot, never arbitrary model coordinates', async () => {
  const result = await POST(request(payload))
  expect(result.headers.get('Cache-Control')).toBe('no-store')
  expect(await result.json()).toEqual({ success: true, controlId: '0' })
  generateContent.mockResolvedValueOnce('{"controlId":"77","x":10,"y":20}')
  expect(await (await POST(request(payload))).json()).toEqual({ success: true, controlId: null })
})
test('decodes an app screenshot before vision analysis', async () => {
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).jpeg().toBuffer()
  expect((await POST(request({ ...payload, image: image.toString('base64') }))).status).toBe(200)
  expect(generateVisionContent).toHaveBeenCalledTimes(1)
  expect(generateContent).not.toHaveBeenCalled()
})
test('rejects malformed images, invalid controls, oversized bodies and provider errors', async () => {
  expect((await POST(request({ ...payload, image: 'bm90IGFuIGltYWdl' }))).status).toBe(422)
  expect((await POST(request({ ...payload, page: 'https://evil.example' }))).status).toBe(400)
  expect((await POST(request({ ...payload, controls: Array(81).fill(payload.controls[0]) }))).status).toBe(400)
  expect((await POST(request({ ...payload, image: 'a'.repeat(3200000) }))).status).toBe(413)
  generateContent.mockRejectedValueOnce(new Error('offline'))
  expect((await POST(request(payload))).status).toBe(422)
})
