import { queryProductivityByIds, getProductivityVisibility } from '@/lib/platform/firestoreProductivityView.server'
test('membership batches share the native 30-disjunction budget with status filters', async () => {
  const store = { list: jest.fn(async () => ({ records: [], nextCursor: null })) }
  await queryProductivityByIds(store, 'leaves', 'employee', Array.from({ length: 31 }, (_, i) => String(i)), [{ field: 'status', operator: 'in', value: ['approved', 'rejected'] }])
  expect(store.list.mock.calls.map(([, query]) => query.filters[0].value.length)).toEqual([12, 12, 7])
  expect(store.list.mock.calls.every(([, query]) => query.filters[0].value.length * query.filters[1].value.length <= 30)).toBe(true)
})
test('a disabled account cannot retain productivity visibility through stale role claims', async () => {
  const store = { get: jest.fn(async () => ({ _id: 'user', role: 'admin', isActive: false })), list: jest.fn() }
  await expect(getProductivityVisibility(store, { _id: 'user', role: 'admin' })).rejects.toMatchObject({ status: 401 })
  expect(store.list).not.toHaveBeenCalled()
})
test('overlap lookups remain below 100 expanded filter/order/parent components', async () => {
  const store = { list: jest.fn(async () => ({ records: [], nextCursor: null })) }
  const filters = [
    { field: 'status', operator: '==', value: 'approved' },
    { field: 'startDate', operator: '<=', value: new Date('2026-10-04') },
    { field: 'endDate', operator: '>=', value: new Date('2026-10-01') },
  ]
  await queryProductivityByIds(store, 'leaves', 'employee', Array.from({ length: 30 }, (_, i) => String(i)), filters)
  expect(store.list.mock.calls.map(([, query]) => query.filters[0].value.length)).toEqual([12, 12, 6])
  for (const [, query] of store.list.mock.calls) expect(query.filters[0].value.length * (query.filters.length + 2 + 2)).toBeLessThanOrEqual(100)
})
test('membership sizing accounts for the two-way indexed search overflow bucket', async () => {
  const store = { list: jest.fn(async () => ({ records: [], nextCursor: null })) }
  await queryProductivityByIds(store, 'employees', 'department', Array.from({ length: 30 }, (_, i) => String(i)), [
    { field: 'status', operator: '==', value: 'active' },
    { field: 'searchGrams', operator: 'array-contains', value: 'ann' },
  ])
  expect(store.list.mock.calls.map(([, query]) => query.filters[0].value.length)).toEqual([10, 10, 10])
})
test('active employee department grants split array membership within the component budget', async () => {
  const departments = Array.from({ length: 30 }, (_, i) => ({ _id: `department-${i}`, isActive: true }))
  const store = {
    get: jest.fn(async () => ({ _id: 'user', employeeId: 'employee', role: 'employee', isActive: true, isDepartmentHead: true, headOfDepartments: departments.map(row => row._id) })),
    getMany: jest.fn(async collection => collection === 'departments' ? departments : []),
    list: jest.fn(async () => ({ records: [], nextCursor: null })),
  }
  await getProductivityVisibility(store, { _id: 'user' }, { activeOnly: true })
  const batches = store.list.mock.calls.filter(([collection, query]) => collection === 'employees' && query.filters.some(filter => filter.field === 'departments'))
  expect(batches.map(([, query]) => query.filters.find(filter => filter.field === 'departments').value.length)).toEqual([25, 5])
})
