jest.mock('@/lib/auth', () => ({ verifyTokenFromRequest: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn() }))
jest.mock('@/lib/ai/providers/pollinationsImageProvider', () => ({ generatePollinationsImage: jest.fn() }))
jest.mock('@/lib/platform/blobStorage.server', () => ({ ...jest.requireActual('@/lib/platform/blobStorage.server'), isBlobStorageConfigured: jest.fn(), uploadTenantBlob: jest.fn(), deleteTenantBlob: jest.fn(), getTenantBlob: jest.fn() }))
import { verifyTokenFromRequest } from '@/lib/auth'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { rateLimit } from '@/lib/security/rateLimiter'
import { generatePollinationsImage } from '@/lib/ai/providers/pollinationsImageProvider'
import { isBlobStorageConfigured, uploadTenantBlob, getTenantBlob, deleteTenantBlob } from '@/lib/platform/blobStorage.server'
import { POST } from '@/app/api/ai/mira-images/route'
import { GET } from '@/app/api/ai/mira-images/[id]/route'
import { validateMiraImageAction } from '@/lib/miraImageGeneration'
import { createHash } from 'node:crypto'
let Image, account, pending
const originalKey = process.env.POLLINATIONS_API_KEY
const id = '1234567890abcdef12345678'
const action = { type: 'generate_image', fields: { prompt: 'A blue bird' } }
const request = body => new Request('http://localhost/api/ai/mira-images', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => {
  jest.clearAllMocks()
  process.env.POLLINATIONS_API_KEY = 'test-only'
  isBlobStorageConfigured.mockReturnValue(true)
  Image = { list: jest.fn(async () => ({ records: [] })), get: jest.fn(async () => null), create: jest.fn(async () => ({ _id: id })), mutate: jest.fn(async () => ({})) }
  account = { _id: 'owner', isActive: true, authVersion: 0 }
  pending = { _id: id, user: 'owner', status: 'pending' }
  Image.replace = jest.fn()
  Image.transaction = jest.fn(async callback => callback({ get: async collection => collection === 'users' ? account : pending, replace: Image.replace }))
  deleteTenantBlob.mockResolvedValue(undefined)
  getFirestoreTenantDatabase.mockResolvedValue(Image)
  verifyTokenFromRequest.mockResolvedValue({ success: true, user: { _id: 'owner' }, tenant: { databaseName: 'tenant-a' } })
  rateLimit.mockResolvedValue({ allowed: true })
  generatePollinationsImage.mockResolvedValue({ buffer: Buffer.from('image'), model: 'test-model', contentType: 'image/png' })
  uploadTenantBlob.mockResolvedValue({ pathname: 'private/path', url: 'https://private-blob.example/image' })
})
afterAll(() => { if (originalKey === undefined) delete process.env.POLLINATIONS_API_KEY; else process.env.POLLINATIONS_API_KEY = originalKey })
test('requires authentication before generation', async () => {
  verifyTokenFromRequest.mockResolvedValue({ success: false })
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
  Image.list.mockResolvedValue({ records: [{ _id: id, status: 'ready' }] })
  expect((await POST(request({ action, requestId: 'request-123' }))).status).toBe(200)
  expect(generatePollinationsImage).not.toHaveBeenCalled()
})
test('fails closed before generation if private Blob is not configured', async () => {
  isBlobStorageConfigured.mockReturnValue(false)
  expect((await POST(request({ action, requestId: 'request-no-blob' }))).status).toBe(503)
  expect(uploadTenantBlob).not.toHaveBeenCalled()
  expect(generatePollinationsImage).not.toHaveBeenCalled()
  expect(Image.create).not.toHaveBeenCalled()
})
test('delivers an owned private Blob image', async () => {
  Image.get.mockResolvedValue({ user: 'owner', status: 'ready', pathname: 'tenants/tenant-a/mira-images/owner/image.png', byteLength: 5, sha256: createHash('sha256').update('image').digest('hex') })
  getTenantBlob.mockResolvedValue({ stream: new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('image')); controller.close() } }) })
  const response = await GET(new Request('http://localhost/image'), { params: Promise.resolve({ id }) })
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('image')
  expect(getTenantBlob).toHaveBeenCalledWith('tenants/tenant-a/mira-images/owner/image.png', { access: 'private' })
})
test('rate limit blocks paid generation', async () => {
  rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 20 })
  expect((await POST(request({ action, requestId: 'request-123' }))).status).toBe(429)
  expect(generatePollinationsImage).not.toHaveBeenCalled()
})
test('image delivery checks the current user in the tenant database', async () => {
  const response = await GET(new Request('http://localhost/image'), { params: Promise.resolve({ id }) })
  expect(response.status).toBe(404)
  expect(Image.get).toHaveBeenCalledWith('mirageneratedimages', id)
  expect(getTenantBlob).not.toHaveBeenCalled()
})
test('denies a foreign owner and cross-tenant Blob path', async () => {
  Image.get.mockResolvedValue({ user: 'someone-else', status: 'ready', pathname: 'tenants/tenant-a/mira-images/owner/image.png' })
  expect((await GET(new Request('http://localhost/image'), { params: { id } })).status).toBe(404)
  Image.get.mockResolvedValue({ user: 'owner', status: 'ready', pathname: 'tenants/tenant-b/mira-images/owner/image.png' })
  expect((await GET(new Request('http://localhost/image'), { params: { id } })).status).toBe(404)
  expect(getTenantBlob).not.toHaveBeenCalled()
})
test.each(['disabled', 'credentials changed'])('does not publish generated media after account is %s during generation', async reason => {
  generatePollinationsImage.mockImplementation(async () => {
    if (reason === 'disabled') account.isActive = false; else account.authVersion++
    return { buffer: Buffer.from('image'), model: 'test-model', contentType: 'image/png' }
  })
  expect((await POST(request({ action, requestId: 'request-revoked' }))).status).toBe(403)
  expect(Image.replace).not.toHaveBeenCalled()
  expect(deleteTenantBlob).toHaveBeenCalledWith('private/path')
})
test('rejects missing integrity metadata before Blob reads and stops oversized streams', async () => {
  const image = { user: 'owner', status: 'ready', pathname: 'tenants/tenant-a/mira-images/owner/image.png' }
  Image.get.mockResolvedValue(image)
  expect((await GET(new Request('http://localhost/image'), { params: { id } })).status).toBe(502)
  expect(getTenantBlob).not.toHaveBeenCalled()
  Image.get.mockResolvedValue({ ...image, byteLength: 5, sha256: createHash('sha256').update('image').digest('hex') })
  const cancel = jest.fn()
  getTenantBlob.mockResolvedValue({ stream: new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('oversized')); }, cancel }) })
  expect((await GET(new Request('http://localhost/image'), { params: { id } })).status).toBe(502)
  expect(cancel).toHaveBeenCalledTimes(1)
})
