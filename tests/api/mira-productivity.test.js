jest.mock('@/lib/platform/firestoreProductivityView.server', () => ({ getProductivityViewStore: jest.fn() }))
import { getProductivityViewStore } from '@/lib/platform/firestoreProductivityView.server'
jest.mock('@/lib/miraPeople', () => ({ resolveMiraPerson: jest.fn() }))
jest.mock('@/lib/productivityPermissions', () => ({ canViewTenantScreenshots: jest.fn() }))
import { miraProductivityGallery } from '@/lib/miraProductivity'
import { resolveMiraPerson } from '@/lib/miraPeople'
import { canViewTenantScreenshots } from '@/lib/productivityPermissions'
import { validateMiraAction } from '@/lib/miraActions'

const fields = { employee: 'Sam', date: '2026-09-25' }
let models
beforeEach(() => {
  jest.clearAllMocks()
  resolveMiraPerson.mockResolvedValue('employee-id')
  canViewTenantScreenshots.mockResolvedValue(true)
  models = { databaseName: 'tenant', composite: null, captures: [], list: jest.fn(async collection => ({ records: collection === 'users' ? [{ _id: 'user-id', name: 'Sam' }] : collection === 'screenshotcomposites' ? (models.composite ? [models.composite] : []) : models.captures, nextCursor: null })) }
  getProductivityViewStore.mockResolvedValue(models)

})
test('action requires employee and date while preserving timestamp fields', () => {
  expect(validateMiraAction({ type: 'view_productivity', fields }).action.fields).toEqual(fields)
  expect(validateMiraAction({ type: 'view_productivity', fields: { employee: 'Sam' } }).error).toBeTruthy()
})
test('denied employee scope never queries screenshot or mosaic data', async () => {
  canViewTenantScreenshots.mockResolvedValue(false)
  await expect(miraProductivityGallery(fields, { _id: 'viewer', role: 'manager' }, models)).rejects.toThrow('within your access')
  expect(models.list.mock.calls.some(([collection]) => collection === 'screenshots')).toBe(false)
  expect(models.list.mock.calls.some(([collection]) => collection === 'screenshotcomposites')).toBe(false)
})
test.each([{ date: '2026-02-30' }, { at: '2026-09-25T12:00' }, { at: '2026-09-24T12:00:00Z' }, { offset: '-1' }])('rejects invalid date/time/pagination before lookup: %j', async invalid => {
  await expect(miraProductivityGallery({ ...fields, ...invalid }, { _id: 'viewer' }, models)).rejects.toThrow()
  expect(resolveMiraPerson).not.toHaveBeenCalled()
})
test('timestamp window filters mosaic sections and never returns arbitrary image URLs', async () => {
  models.composite = ({ _id: 'composite-id', gridfsFileId: 'stored', tiles: [
    { index: 0, capturedAt: '2026-09-25T06:30:00Z' },
    { index: 1, capturedAt: '2026-09-25T06:34:00Z' },
    { index: 2, capturedAt: '2026-09-25T07:00:00Z' },
  ] })
  const result = await miraProductivityGallery({ ...fields, at: '2026-09-25T12:00:00+05:30' }, { _id: 'viewer' }, models)
  expect(result.gallery.items).toHaveLength(2)
  expect(result.gallery.items[1].imageUrl).toBe('/api/productivity/composite/image?id=composite-id&userId=user-id&date=2026-09-25&tile=1')
  expect(models.list.mock.calls.some(([collection]) => collection === 'screenshots')).toBe(false)
})
test('date gallery paginates and retains canonical employee for next request', async () => {
  models.composite = ({ _id: 'c', gridfsFileId: 'g', tiles: Array.from({ length: 35 }, (_, index) => ({ index, capturedAt: `2026-09-25T06:${String(index).padStart(2, '0')}:00Z` })) })
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
