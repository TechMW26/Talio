import { readNewestDashboardLeaves } from '@/lib/dashboardLeaveQuery.server'

const filters = [{ field: 'status', operator: '==', value: 'pending' }]
test('empty employee scope cannot turn into an organization query', async () => {
  const db = { list: jest.fn() }
  expect(await readNewestDashboardLeaves(db, filters, [], 10)).toEqual([])
  expect(db.list).not.toHaveBeenCalled()
})
test('large scopes use bounded concurrency and return global newest records', async () => {
  let active = 0, peak = 0
  const ids = Array.from({ length: 150 }, (_, i) => String(i))
  const db = { list: jest.fn(async (_, options) => {
    peak = Math.max(peak, ++active)
    await new Promise(resolve => setTimeout(resolve, 1))
    active--
    const batch = options.filters.find(f => f.field === 'employee').value
    return { records: batch.map(_id => ({ _id, createdAt: new Date(Number(_id) * 1000) })).reverse().slice(0, options.limit), nextCursor: 'older' }
  }) }
  const result = await readNewestDashboardLeaves(db, filters, [...ids, '0', null], 10)
  expect(result.map(row => row._id)).toEqual(Array.from({ length: 10 }, (_, i) => String(149 - i)))
  expect(peak).toBe(3)
  const queried = db.list.mock.calls.flatMap(([, options]) => {
    expect(options.limit).toBe(10)
    expect(options.filters).toContainEqual(filters[0])
    expect(options.orderBy).toEqual([{ field: 'createdAt', direction: 'desc' }])
    return options.filters.find(f => f.field === 'employee').value
  })
  expect(queried).toEqual(ids)
})
test('failures stop scheduling and never produce partial success', async () => {
  const db = { list: jest.fn(async () => { throw new Error('unavailable') }) }
  await expect(readNewestDashboardLeaves(db, filters, Array.from({ length: 200 }, (_, i) => String(i)), 5)).rejects.toThrow('unavailable')
  expect(db.list).toHaveBeenCalledTimes(3)
})
test('equal timestamps have deterministic ordering and duplicate rows are removed', async () => {
  const db = { list: jest.fn(async () => ({ records: ['b', 'a', 'b'].map(_id => ({ _id, createdAt: new Date(0) })) })) }
  expect((await readNewestDashboardLeaves(db, filters, ['employee'], 5)).map(row => row._id)).toEqual(['a', 'b'])
})
