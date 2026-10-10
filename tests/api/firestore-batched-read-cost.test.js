import { getManyProductivityRecords, queryProductivityByIds, getProductivityVisibility } from '@/lib/platform/firestoreProductivityView.server'
jest.mock('@/lib/platform/firestoreApplication.server', () => ({}))
test('manager visibility reads run concurrently with unchanged grants and deduplication', async () => {
  let active = 0, peak = 0
  const fields = []
  const store = {
    get: jest.fn(async () => ({ _id: 'user-a', employeeId: 'employee-a', role: 'employee' })),
    getMany: jest.fn(async () => []),
    list: jest.fn(async (collection, options) => {
      if (collection === 'departments') return { records: [] }
      peak = Math.max(peak, ++active)
      const grant = options.filters.find(f => f.field !== 'status')
      fields.push(grant.field)
      expect(grant.value).toBe('employee-a')
      expect(options.filters).toContainEqual({ field: 'status', operator: '==', value: 'active' })
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      return { records: [{ _id: 'report-a', status: 'active' }] }
    }),
  }
  const result = await getProductivityVisibility(store, { _id: 'user-a' }, { activeOnly: true })
  expect(peak).toBe(3)
  expect(fields).toEqual(['assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager'])
  expect(result.employees).toEqual([{ _id: 'report-a', status: 'active' }])
})
test('deduplicates IDs and skips empty batches', async () => {
  const store = { getMany: jest.fn(async (_, ids) => ids.map(_id => ({ _id }))) }
  expect(await getManyProductivityRecords(store, 'employees', [])).toEqual([])
  expect(store.getMany).not.toHaveBeenCalled()
  expect(await getManyProductivityRecords(store, 'employees', ['a', 'a', null, 'b'])).toEqual([{ _id: 'a' }, { _id: 'b' }])
  expect(store.getMany).toHaveBeenCalledWith('employees', ['a', 'b'])
})
test('reads concurrently but bounds concurrency to three and keeps order', async () => {
  let active = 0, peak = 0
  const store = { getMany: jest.fn(async (_, ids) => {
    peak = Math.max(peak, ++active)
    await new Promise(resolve => setTimeout(resolve, ids[0] === '0' ? 10 : 1))
    active--
    return ids.map(_id => ({ _id }))
  }) }
  const ids = Array.from({ length: 750 }, (_, i) => String(i))
  expect((await getManyProductivityRecords(store, 'employees', ids)).map(r => r._id)).toEqual(ids)
  expect(peak).toBe(3)
  expect(store.getMany).toHaveBeenCalledTimes(8)
  expect(store.getMany.mock.calls.every(([, batch]) => batch.length <= 100)).toBe(true)
})
test('membership batches retain filters, paginate and deduplicate records', async () => {
  const filters = [{ field: 'status', operator: '==', value: 'approved' }]
  const store = { list: jest.fn(async (_, options) => ({ records: options.filters[0].value.map(_id => ({ _id })), nextCursor: null })) }
  const ids = Array.from({ length: 265 }, (_, i) => String(i))
  expect((await queryProductivityByIds(store, 'leaves', 'employee', [...ids, '0'], filters)).map(r => r._id)).toEqual(ids)
  expect(store.list).toHaveBeenCalledTimes(3)
  for (const [, options] of store.list.mock.calls) {
    expect(options.filters.slice(1)).toEqual(filters)
    expect(options.limit).toBe(100)
    expect(options.filters[0].value.length).toBeLessThanOrEqual(100)
  }
})
test('failed reads reject rather than returning incomplete records', async () => {
  const store = { getMany: jest.fn(async () => { throw new Error('Unavailable') }) }
  await expect(getManyProductivityRecords(store, 'employees', Array.from({ length: 900 }, (_, i) => String(i)))).rejects.toThrow('Unavailable')
  expect(store.getMany).toHaveBeenCalledTimes(3)
})
