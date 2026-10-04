import { readProfileDocumentImage } from '@/lib/platform/profileDocumentImage.server'
import { getImage, getImageInfo } from '@/lib/mediaStorage'
jest.mock('@/lib/mediaStorage', () => ({ getImage: jest.fn(), getImageInfo: jest.fn() }))
const originalFetch = global.fetch
const originalEndpoint = process.env.IMAGEKIT_URL_ENDPOINT
const originalPublicEndpoint = process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT
beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.IMAGEKIT_URL_ENDPOINT
  delete process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT
  global.fetch = jest.fn()
})
afterAll(() => {
  global.fetch = originalFetch
  if (originalEndpoint === undefined) delete process.env.IMAGEKIT_URL_ENDPOINT; else process.env.IMAGEKIT_URL_ENDPOINT = originalEndpoint
  if (originalPublicEndpoint === undefined) delete process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT; else process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT = originalPublicEndpoint
})
test('OCR prefers native media references and passes the authenticated tenant', async () => {
  getImage.mockResolvedValue(Buffer.from('private-image'))
  getImageInfo.mockResolvedValue({ contentType: 'image/png' })
  const fileId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
  expect(await readProfileDocumentImage({ fileId, url: 'https://untrusted.invalid/ignored' }, 'tenant-a')).toEqual({ base64: Buffer.from('private-image').toString('base64'), mimeType: 'image/png' })
  expect(getImage).toHaveBeenCalledWith(fileId, { databaseName: 'tenant-a' })
  expect(getImageInfo).toHaveBeenCalledWith(fileId, { databaseName: 'tenant-a' })
  expect(global.fetch).not.toHaveBeenCalled()
})
test.each(['/uploads/aadhaar/user/old.png', 'file:///etc/passwd', 'http://ik.imagekit.io/image.png', 'https://example.invalid/image.png', 'https://user:pass@ik.imagekit.io/image.png'])('rejects local or arbitrary image sources: %s', async url => {
  await expect(readProfileDocumentImage({ url }, 'tenant-a')).rejects.toThrow()
  expect(global.fetch).not.toHaveBeenCalled()
})
test('retained ImageKit references are read-only, bounded and never follow redirects', async () => {
  global.fetch.mockResolvedValue(new Response('image-bytes', { headers: { 'content-type': 'image/webp' } }))
  expect(await readProfileDocumentImage({ url: 'https://ik.imagekit.io/account/file.webp' }, 'tenant-a')).toMatchObject({ mimeType: 'image/webp' })
  expect(global.fetch).toHaveBeenCalledWith('https://ik.imagekit.io/account/file.webp', expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }))
  global.fetch.mockResolvedValue(new Response('not-an-image', { headers: { 'content-type': 'text/html' } }))
  await expect(readProfileDocumentImage({ url: 'https://ik.imagekit.io/account/file.webp' }, 'tenant-a')).rejects.toThrow('Unsupported')
  global.fetch.mockResolvedValue(new Response(new Uint8Array(10 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } }))
  await expect(readProfileDocumentImage({ url: 'https://ik.imagekit.io/account/file.png' }, 'tenant-a')).rejects.toThrow('exceeds')
})
test('configured custom ImageKit endpoint cannot escape its path prefix', async () => {
  process.env.IMAGEKIT_URL_ENDPOINT = 'https://media.example.invalid/trusted'
  await expect(readProfileDocumentImage({ url: 'https://media.example.invalid/trusted-other/file.png' }, 'tenant-a')).rejects.toThrow('approved')
  expect(global.fetch).not.toHaveBeenCalled()
})
