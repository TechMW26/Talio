jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn() }))
jest.mock('@/lib/ai/providers/pollinationsImageProvider', () => ({ generatePollinationsImage: jest.fn() }))
jest.mock('@/lib/platform/blobStorage.server', () => ({ isBlobStorageConfigured: jest.fn(), uploadTenantBlob: jest.fn(), deleteTenantBlob: jest.fn(), getTenantBlob: jest.fn() }))
import { getAuthAndModels } from '@/lib/auth'
import { rateLimit } from '@/lib/security/rateLimiter'
import { generatePollinationsImage } from '@/lib/ai/providers/pollinationsImageProvider'
import { isBlobStorageConfigured, uploadTenantBlob, getTenantBlob } from '@/lib/platform/blobStorage.server'
import { POST } from '@/app/api/ai/mira-images/route'
import { GET } from '@/app/api/ai/mira-images/[id]/route'
import { validateMiraImageAction } from '@/lib/miraImageGeneration'
let Image
const originalKey = process.env.POLLINATIONS_API_KEY
const id = '1234567890abcdef12345678'
const action = { type: 'generate_image', fields: { prompt: 'A blue bird' } }
const request = body => new Request('http://localhost/api/ai/mira-images', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => {
  jest.clearAllMocks()
  process.env.POLLINATIONS_API_KEY = 'test-only'
  isBlobStorageConfigured.mockReturnValue(true)
  Image = { findOne: jest.fn(() => ({ lean: async () => null, select: async () => null })), create: jest.fn(async () => ({ _id: id })), updateOne: jest.fn(async () => ({})) }
  getAuthAndModels.mockResolvedValue({ success: true, user: { _id: 'owner' }, tenant: { databaseName: 'tenant-a' }, models: { MiraGeneratedImage: Image } })
  rateLimit.mockResolvedValue({ allowed: true })
  generatePollinationsImage.mockResolvedValue({ buffer: Buffer.from('image'), model: 'test-model', contentType: 'image/png' })
  uploadTenantBlob.mockResolvedValue({ pathname: 'private/path', url: 'https://private-blob.example/image' })
})
afterAll(() => { if (originalKey === undefined) delete process.env.POLLINATIONS_API_KEY; else process.env.POLLINATIONS_API_KEY = originalKey })
test('requires authentication before generation', async () => {
  getAuthAndModels.mockResolvedValue({ success: false })
  expect((await POST(request({ action, requestId: 'request-123' }))).status).toBe(401)
  expect(generatePollinationsImage).not.toHaveBeenCalled()
})
test('validates prompt and ignores model-supplied URLs/options', () => {
  expect(validateMiraImageAction({ ...action, url: 'https://evil.example', fields: { ...action.fields, model: 'evil' } })).toEqual(action)
  expect(validateMiraImageAction({ ...action, fields: { prompt: 'x'.repeat(4001) } })).toBeNull()
})
test('stores a private image under tenant and owner, exposing only an ID', async () => {
  const result = await (await POST(request({ action, requestId: 'request-123' }))).json()
  expect(result).toEqual({ success: true, image: { id, status: 'ready' } })
  expect(uploadTenantBlob).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', ownerId: 'owner', access: 'private' }))
})
test('same completed request does not regenerate', async () => {
  Image.findOne.mockReturnValue({ lean: async () => ({ _id: id, status: 'ready' }) })
  expect((await POST(request({ action, requestId: 'request-123' }))).status).toBe(200)
  expect(generatePollinationsImage).not.toHaveBeenCalled()
})
test('uses capped private Mongo storage when Blob is not configured', async () => {
  isBlobStorageConfigured.mockReturnValue(false)
  expect((await POST(request({ action, requestId: 'request-mongo' }))).status).toBe(200)
  expect(uploadTenantBlob).not.toHaveBeenCalled()
  expect(Image.updateOne).toHaveBeenCalledWith(expect.objectContaining({ user: 'owner' }), { $set: expect.objectContaining({ imageBuffer: Buffer.from('image'), status: 'ready' }) })
})
test('delivers an owned Mongo image without accessing external storage', async () => {
  Image.findOne.mockReturnValue({ select: async () => ({ imageBuffer: Buffer.from('image') }) })
  const response = await GET(new Request('http://localhost/image'), { params: Promise.resolve({ id }) })
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('image')
  expect(getTenantBlob).not.toHaveBeenCalled()
})
test('rate limit blocks paid generation', async () => {
  rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 20 })
  expect((await POST(request({ action, requestId: 'request-123' }))).status).toBe(429)
  expect(generatePollinationsImage).not.toHaveBeenCalled()
})
test('image delivery checks the current user in the tenant database', async () => {
  const response = await GET(new Request('http://localhost/image'), { params: Promise.resolve({ id }) })
  expect(response.status).toBe(404)
  expect(Image.findOne).toHaveBeenCalledWith({ _id: id, user: 'owner', status: 'ready' })
  expect(getTenantBlob).not.toHaveBeenCalled()
})
