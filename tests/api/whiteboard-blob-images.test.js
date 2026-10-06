import { createHash } from 'node:crypto'
import { storeWhiteboardImages, rollbackWhiteboardImages } from '@/lib/whiteboardMedia.server'
import { uploadImage, deleteImage } from '@/lib/mediaStorage'
import { processImage } from '@/lib/imagePipeline'
jest.mock('@/lib/mediaStorage', () => ({ uploadImage: jest.fn(), deleteImage: jest.fn() }))
jest.mock('@/lib/imagePipeline', () => ({ processImage: jest.fn() }))
jest.mock('@/lib/whiteboards.server', () => ({ boardError: (message, status = 400) => Object.assign(new Error(message), { status }) }))
const context = { databaseName: 'talio_company_test', userId: 'user' }
const image = 'data:image/png;base64,aGVsbG8='
const pages = [{ id: 'page-1', objects: [{ id: 'image', image }] }]
beforeEach(() => {
  jest.clearAllMocks()
  processImage.mockResolvedValue({ buffer: Buffer.from('processed'), format: 'webp', mimeType: 'image/webp' })
  uploadImage.mockResolvedValue({ _id: 'file', url: '/api/images/file' })
  deleteImage.mockResolvedValue(true)
})
test('canvas bytes use private media storage while repeated autosaves reuse a committed hash', async () => {
  const uploaded = []
  const stored = await storeWhiteboardImages(context, pages, [], uploaded)
  expect(stored[0].objects[0]).toMatchObject({ image: '/api/images/file', imageFileId: 'file', imageSourceSha256: createHash('sha256').update('hello').digest('hex') })
  expect(uploaded).toEqual(['file'])
  expect(uploadImage).toHaveBeenCalledWith(Buffer.from('processed'), expect.objectContaining({ databaseName: context.databaseName, userId: 'user' }))
  const reused = await storeWhiteboardImages(context, pages, stored, uploaded)
  expect(reused).toEqual(stored)
  expect(uploadImage).toHaveBeenCalledTimes(1)
  expect(pages[0].objects[0].image).toBe(image)
})
test('invalid images fail closed and failed saves can compensate newly uploaded bytes', async () => {
  await expect(storeWhiteboardImages(context, [{ id: 'page', objects: [{ image: 'data:text/html;base64,dGVzdA==' }] }], [])).rejects.toMatchObject({ status: 400 })
  expect(uploadImage).not.toHaveBeenCalled()
  await rollbackWhiteboardImages(context, ['file'])
  expect(deleteImage).toHaveBeenCalledWith('file', { databaseName: context.databaseName })
})
