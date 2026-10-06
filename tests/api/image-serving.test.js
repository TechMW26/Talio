import { GET } from '@/app/api/images/[id]/route'
import { resolveImage } from '@/lib/mediaStorage'
import { verifyTokenFromRequest } from '@/lib/auth'
import { canReadDocumentUpload } from '@/lib/documentAccess.server'
import { getOrCreateImageVariant } from '@/lib/platform/imageVariants.server'
jest.mock('@/lib/mediaStorage', () => ({ resolveImage: jest.fn() }))
jest.mock('@/lib/auth', () => ({ verifyTokenFromRequest: jest.fn() }))
jest.mock('@/lib/documentAccess.server', () => ({ canReadDocumentUpload: jest.fn() }))
jest.mock('@/lib/platform/imageVariants.server', () => ({ standardImageVariant: () => 256, getOrCreateImageVariant: jest.fn() }))
const id = '111111111111111111111111'
const request = query => GET(new Request(`https://app.test/api/images/${id}${query || ''}`), { params: Promise.resolve({ id }) })
let open, file
beforeEach(() => {
  jest.resetAllMocks()
  open = jest.fn(async () => ({ stream: new Blob(['source']).stream() }))
  file = { contentType: 'image/png', length: 6, metadata: {} }
  resolveImage.mockImplementation(async () => ({ file, open, variantIdentity: { id } }))
  verifyTokenFromRequest.mockResolvedValue({ success: true, tenant: { databaseName: 'talio_company_a' }, user: { _id: 'user-a', role: 'employee' } })
})
test('unauthenticated requests do not resolve media', async () => {
  verifyTokenFromRequest.mockResolvedValue({ success: false })
  expect((await request()).status).toBe(401)
  expect(resolveImage).not.toHaveBeenCalled()
})
test.each(['documents', 'aadhaar'])('cached %s images still require authorization', async category => {
  file.metadata = { category, userId: 'other-user' }
  canReadDocumentUpload.mockResolvedValue(false)
  expect((await request('?w=256&h=256')).status).toBe(403)
  expect(getOrCreateImageVariant).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
})
test('original is resolved once and streamed without public caching', async () => {
  const response = await request()
  expect(await response.text()).toBe('source')
  expect(resolveImage).toHaveBeenCalledTimes(1)
  expect(resolveImage).toHaveBeenCalledWith(id, { databaseName: 'talio_company_a' })
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
})
test('authorized cache hit never opens original', async () => {
  getOrCreateImageVariant.mockResolvedValue(new Blob(['thumbnail']).stream())
  const response = await request('?w=256&h=256')
  expect(await response.text()).toBe('thumbnail')
  expect(open).not.toHaveBeenCalled()
  expect(response.headers.get('Content-Type')).toBe('image/webp')
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
})
