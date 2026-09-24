jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn() }))
jest.mock('@/lib/ai/aiProviderManager', () => ({ generateVisionContent: jest.fn() }))
import { getAuthAndModels } from '@/lib/auth'
import { rateLimit } from '@/lib/security/rateLimiter'
import { generateVisionContent } from '@/lib/ai/aiProviderManager'
import { POST } from '@/app/api/ai/mira-attachments/route'

const request = (name, contents) => ({
  headers: new Headers(),
  formData: async () => new Map([['file', { name, size: Buffer.byteLength(contents), arrayBuffer: async () => Buffer.from(contents) }]]),
})
beforeEach(() => {
  jest.clearAllMocks()
  getAuthAndModels.mockResolvedValue({ success: true, tenant: { databaseName: 'tenant' }, user: { _id: 'owner' } })
  rateLimit.mockResolvedValue({ allowed: true })
})
test('requires authentication before file processing', async () => {
  getAuthAndModels.mockResolvedValue({ success: false })
  expect((await POST(request('a.txt', 'hello'))).status).toBe(401)
  expect(rateLimit).not.toHaveBeenCalled()
})
test('reads bounded text without calling a vision model or creating public URLs', async () => {
  const result = await (await POST(request('notes.txt', 'x'.repeat(10001)))).json()
  expect(result.attachment.text).toHaveLength(10000)
  expect(result.attachment.truncated).toBe(true)
  expect(result.attachment.url).toBeUndefined()
  expect(generateVisionContent).not.toHaveBeenCalled()
  expect(rateLimit).toHaveBeenCalledWith('MIRA_ATTACHMENT', 'tenant:owner')
})
test('rejects unsupported, binary and disguised image files', async () => {
  expect((await POST(request('a.pdf', 'pdf'))).status).toBe(400)
  expect((await POST(request('a.txt', 'a\0b'))).status).toBe(422)
  expect((await POST(request('a.png', 'not an image'))).status).toBe(422)
  expect(generateVisionContent).not.toHaveBeenCalled()
})
test('rate limits paid file processing', async () => {
  rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 })
  expect((await POST(request('a.png', 'image'))).status).toBe(429)
  expect(generateVisionContent).not.toHaveBeenCalled()
})
