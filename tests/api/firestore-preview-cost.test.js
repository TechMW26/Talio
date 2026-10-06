import { readFirestorePreview } from '@/lib/platform/firestoreQueries.server'

const options = { filters: [{ field: 'isActive', operator: '==', value: true }], orderBy: [{ field: 'createdAt', direction: 'desc' }] }
test('stops after five visible rows even when more database pages exist', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ _id: String(i) }))
  const database = { list: jest.fn(async () => ({ records: rows, nextCursor: 'more' })) }
  expect(await readFirestorePreview(database, 'policies', options, () => true)).toEqual(rows)
  expect(database.list).toHaveBeenCalledTimes(1)
  expect(database.list).toHaveBeenCalledWith('policies', { ...options, limit: 5, cursor: null })
})
test('skips forbidden rows before limiting and widens sparse scans', async () => {
  const database = { list: jest.fn()
    .mockResolvedValueOnce({ records: Array.from({ length: 5 }, (_, i) => ({ _id: `hidden${i}` })), nextCursor: 'second' })
    .mockResolvedValueOnce({ records: Array.from({ length: 9 }, (_, i) => ({ _id: String(i), visible: i % 2 === 0 })), nextCursor: 'third' }) }
  expect((await readFirestorePreview(database, 'policies', options, row => row.visible)).map(row => row._id)).toEqual(['0', '2', '4', '6', '8'])
  expect(database.list).toHaveBeenCalledTimes(2)
  expect(database.list.mock.calls[1][1]).toEqual({ ...options, limit: 100, cursor: 'second' })
})
test('returns fewer matches only when exhausted and propagates failures', async () => {
  const database = { list: jest.fn(async () => ({ records: [{ _id: 'a' }], nextCursor: null })) }
  expect(await readFirestorePreview(database, 'policies', options, () => true)).toEqual([{ _id: 'a' }])
  database.list.mockRejectedValue(new Error('offline'))
  await expect(readFirestorePreview(database, 'policies', options, () => true)).rejects.toThrow('offline')
})
test('enforces scan bounds instead of returning an incomplete preview', async () => {
  const database = { list: jest.fn(async () => ({ records: Array.from({ length: 5 }, () => ({})), nextCursor: 'more' })) }
  await expect(readFirestorePreview(database, 'policies', options, () => false, 5, 5)).rejects.toThrow('too large')
})
