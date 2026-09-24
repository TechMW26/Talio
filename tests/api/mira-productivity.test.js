jest.mock('@/lib/miraPeople', () => ({ resolveMiraPerson: jest.fn() }))
jest.mock('@/lib/productivityPermissions', () => ({ canViewUserScreenshots: jest.fn() }))
import { miraProductivityGallery } from '@/lib/miraProductivity'
import { resolveMiraPerson } from '@/lib/miraPeople'
import { canViewUserScreenshots } from '@/lib/productivityPermissions'
import { validateMiraAction } from '@/lib/miraActions'

const fields = { employee: 'Sam', date: '2026-09-25' }
let models
beforeEach(() => {
  jest.clearAllMocks()
  resolveMiraPerson.mockResolvedValue('employee-id')
  canViewUserScreenshots.mockResolvedValue(true)
  const query = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) }
  models = {
    User: { findOne: jest.fn(() => ({ select: () => ({ lean: async () => ({ _id: 'user-id', name: 'Sam' }) }) })) },
    ScreenshotComposite: { findOne: jest.fn(() => ({ lean: async () => null })) },
    Screenshot: { find: jest.fn(() => query) },
  }
})
test('action requires employee and date while preserving timestamp fields', () => {
  expect(validateMiraAction({ type: 'view_productivity', fields }).action.fields).toEqual(fields)
  expect(validateMiraAction({ type: 'view_productivity', fields: { employee: 'Sam' } }).error).toBeTruthy()
})
test('denied employee scope never queries screenshot or mosaic data', async () => {
  canViewUserScreenshots.mockResolvedValue(false)
  await expect(miraProductivityGallery(fields, { _id: 'viewer', role: 'manager' }, models)).rejects.toThrow('within your access')
  expect(models.Screenshot.find).not.toHaveBeenCalled()
  expect(models.ScreenshotComposite.findOne).not.toHaveBeenCalled()
})
test.each([{ date: '2026-02-30' }, { at: '2026-09-25T12:00' }, { at: '2026-09-24T12:00:00Z' }, { offset: '-1' }])('rejects invalid date/time/pagination before lookup: %j', async invalid => {
  await expect(miraProductivityGallery({ ...fields, ...invalid }, { _id: 'viewer' }, models)).rejects.toThrow()
  expect(resolveMiraPerson).not.toHaveBeenCalled()
})
test('timestamp window filters mosaic sections and never returns arbitrary image URLs', async () => {
  models.ScreenshotComposite.findOne.mockReturnValue({ lean: async () => ({ _id: 'composite-id', gridfsFileId: 'stored', tiles: [
    { index: 0, capturedAt: '2026-09-25T06:30:00Z' },
    { index: 1, capturedAt: '2026-09-25T06:34:00Z' },
    { index: 2, capturedAt: '2026-09-25T07:00:00Z' },
  ] }) })
  const result = await miraProductivityGallery({ ...fields, at: '2026-09-25T12:00:00+05:30' }, { _id: 'viewer' }, models)
  expect(result.gallery.items).toHaveLength(2)
  expect(result.gallery.items[1].imageUrl).toBe('/api/productivity/composite/image?id=composite-id&userId=user-id&date=2026-09-25&tile=1')
  expect(models.Screenshot.find).not.toHaveBeenCalled()
})
test('date gallery paginates and retains canonical employee for next request', async () => {
  models.ScreenshotComposite.findOne.mockReturnValue({ lean: async () => ({ _id: 'c', gridfsFileId: 'g', tiles: Array.from({ length: 35 }, (_, index) => ({ index, capturedAt: `2026-09-25T06:${String(index).padStart(2, '0')}:00Z` })) }) })
  const first = await miraProductivityGallery(fields, { _id: 'viewer' }, models)
  expect(first.gallery.items).toHaveLength(30)
  expect(first.gallery).toMatchObject({ hasMore: true, nextOffset: 30, fields: { employee: 'employee:employee-id' } })
  const last = await miraProductivityGallery({ ...fields, offset: '30' }, { _id: 'viewer' }, models)
  expect(last.gallery.items).toHaveLength(5)
  expect(last.gallery.hasMore).toBe(false)
})
test('missing images returns an honest empty result', async () => {
  const result = await miraProductivityGallery(fields, { _id: 'viewer' }, models)
  expect(result.gallery.items).toEqual([])
  expect(result.message).toContain('No retained captures')
})
