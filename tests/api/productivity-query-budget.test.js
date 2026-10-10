import { queryProductivityByIds, getProductivityVisibility } from '@/lib/platform/firestoreProductivityView.server'
test('Mongo membership batches use a 100-ID work bound without multiplying status filters', async () => {
  const store = { list: jest.fn(async () => ({ records: [], nextCursor: null })) }
  const ids = Array.from({ length: 210 }, (_, i) => String(i))
  const filters = [{ field: 'status', operator: 'in', value: ['approved', 'rejected'] }]
  await queryProductivityByIds(store, 'leaves', 'employee', ids, filters)
  expect(store.list.mock.calls.map(([, query]) => query.filters[0].value.length)).toEqual([100, 100, 10])
  expect(store.list.mock.calls.flatMap(([, query]) => query.filters[0].value)).toEqual(ids)
  for (const [collection, query] of store.list.mock.calls) {
    expect(collection).toBe('leaves')
    expect(query.filters[0]).toMatchObject({ field: 'employee', operator: 'in' })
    expect(query.filters.slice(1)).toEqual(filters)
    expect(query.limit).toBe(100)
  }
})
test('a disabled account cannot retain productivity visibility through stale role claims', async () => {
  const store = { get: jest.fn(async () => ({ _id: 'user', role: 'admin', isActive: false })), list: jest.fn() }
  await expect(getProductivityVisibility(store, { _id: 'user', role: 'admin' })).rejects.toMatchObject({ status: 401 })
  expect(store.list).not.toHaveBeenCalled()
})
test('Mongo overlap lookups preserve date and status constraints in every bounded batch', async () => {
  const store = { list: jest.fn(async () => ({ records: [], nextCursor: null })) }
  const filters = [
    { field: 'status', operator: '==', value: 'approved' },
    { field: 'startDate', operator: '<=', value: new Date('2026-10-04') },
    { field: 'endDate', operator: '>=', value: new Date('2026-10-01') },
  ]
  const ids = Array.from({ length: 205 }, (_, i) => String(i))
  await queryProductivityByIds(store, 'leaves', 'employee', ids, filters)
  expect(store.list.mock.calls.map(([, query]) => query.filters[0].value.length)).toEqual([100, 100, 5])
  expect(store.list.mock.calls.flatMap(([, query]) => query.filters[0].value)).toEqual(ids)
  for (const [, query] of store.list.mock.calls) {
    expect(query.filters.slice(1)).toEqual(filters)
    expect(query.limit).toBe(100)
  }
})
test('Mongo indexed search keeps its filters without legacy overflow-disjunction splitting', async () => {
  const store = { list: jest.fn(async () => ({ records: [], nextCursor: null })) }
  const filters = [
    { field: 'status', operator: '==', value: 'active' },
    { field: 'searchGrams', operator: 'array-contains', value: 'ann' },
  ]
  await queryProductivityByIds(store, 'employees', 'department', Array.from({ length: 250 }, (_, i) => String(i)), filters)
  expect(store.list.mock.calls.map(([, query]) => query.filters[0].value.length)).toEqual([100, 100, 50])
  for (const [, query] of store.list.mock.calls) {
    expect(query.filters.slice(1)).toEqual(filters)
    expect(query.limit).toBe(100)
  }
})
test('active employee department grants retain exact scope in 100-ID Mongo array-membership batches', async () => {
  const departments = Array.from({ length: 205 }, (_, i) => ({ _id: `department-${i}`, isActive: true }))
  const departmentMap = new Map(departments.map(row => [row._id, row]))
  const store = {
    get: jest.fn(async () => ({ _id: 'user', employeeId: 'employee', role: 'employee', isActive: true, isDepartmentHead: true, headOfDepartments: departments.map(row => row._id) })),
    getMany: jest.fn(async (collection, ids) => collection === 'departments' ? ids.map(id => departmentMap.get(id)) : []),
    list: jest.fn(async () => ({ records: [], nextCursor: null })),
  }
  const result = await getProductivityVisibility(store, { _id: 'user' }, { activeOnly: true })
  const batches = store.list.mock.calls.filter(([collection, query]) => collection === 'employees' && query.filters.some(filter => filter.field === 'departments'))
  expect(batches.map(([, query]) => query.filters.find(filter => filter.field === 'departments').value.length)).toEqual([100, 100, 5])
  expect(batches.flatMap(([, query]) => query.filters.find(filter => filter.field === 'departments').value)).toEqual(departments.map(row => row._id))
  for (const [, query] of batches) {
    expect(query.filters).toContainEqual({ field: 'status', operator: '==', value: 'active' })
    expect(query.filters.find(filter => filter.field === 'departments').operator).toBe('array-contains-any')
    expect(query.limit).toBe(100)
  }
  expect(store.getMany.mock.calls.filter(([collection]) => collection === 'departments').map(([, ids]) => ids.length)).toEqual([100, 100, 5])
  expect(result.departments).toEqual(departments)
})

test('large membership scopes keep at most three queries in flight and preserve batch order', async () => {
  let active = 0, peak = 0
  const ids = Array.from({ length: 750 }, (_, i) => String(i))
  const filters = [{ field: 'status', operator: '==', value: 'approved' }]
  const store = { list: jest.fn(async (_, query) => {
    peak = Math.max(peak, ++active)
    await new Promise(resolve => setTimeout(resolve, query.filters[0].value[0] === '0' ? 10 : 1))
    active--
    return { records: query.filters[0].value.map(_id => ({ _id })), nextCursor: null }
  }) }
  const records = await queryProductivityByIds(store, 'leaves', 'employee', [...ids, '0', null, ''], filters)
  expect(peak).toBe(3)
  expect(active).toBe(0)
  expect(store.list).toHaveBeenCalledTimes(8)
  expect(records.map(row => row._id)).toEqual(ids)
  for (const [, query] of store.list.mock.calls) {
    expect(query.filters[0].value.length).toBeLessThanOrEqual(100)
    expect(query.filters.slice(1)).toEqual(filters)
    expect(query.limit).toBe(100)
  }
})

test('each Mongo membership batch follows its own cursor without dropping scope filters', async () => {
  const ids = Array.from({ length: 101 }, (_, i) => String(i))
  const filters = [{ field: 'status', operator: 'in', value: ['approved', 'rejected'] }]
  const store = { list: jest.fn(async (_, query) => {
    const batch = query.filters[0].value
    if (batch.length === 100 && !query.cursor) return { records: batch.slice(0, 50).map(_id => ({ _id })), nextCursor: 'page-two' }
    return { records: (query.cursor ? batch.slice(50) : batch).map(_id => ({ _id })), nextCursor: null }
  }) }
  expect((await queryProductivityByIds(store, 'leaves', 'employee', ids, filters)).map(row => row._id)).toEqual(ids)
  expect(store.list).toHaveBeenCalledTimes(3)
  const secondPage = store.list.mock.calls.find(([, query]) => query.cursor === 'page-two')[1]
  expect(secondPage.filters[0].value).toEqual(ids.slice(0, 100))
  for (const [, query] of store.list.mock.calls) {
    expect(query.filters.slice(1)).toEqual(filters)
    expect(query.limit).toBe(100)
  }
})
