import { populateEmployeeRoster } from '@/lib/employees.server'

test('roster user reads overlap relationship reads with at most three batches and retain employee order', async () => {
  const pending = []
  let releaseDepartments
  const database = {
    getMany: jest.fn(() => new Promise(resolve => { releaseDepartments = resolve })),
    list: jest.fn((collection, options) => new Promise(resolve => {
      pending.push({ resolve, ids: options.filters[0].value })
    })),
  }
  const records = Array.from({ length: 100 }, (_, i) => ({ _id: String(i), firstName: `Employee ${i}`, department: 'department' }))
  const result = populateEmployeeRoster(database, records)
  expect(database.getMany).toHaveBeenCalledTimes(1)
  expect(database.list).toHaveBeenCalledTimes(3)
  expect(pending.map(batch => batch.ids.length)).toEqual([30, 30, 30])
  const complete = batch => batch.resolve({ records: batch.ids.map(employeeId => ({ _id: `user-${employeeId}`, employeeId, email: `${employeeId}@example.test`, role: 'employee', password: 'must-not-appear' })), nextCursor: null })
  complete(pending[2]); complete(pending[1])
  await new Promise(resolve => setImmediate(resolve))
  expect(database.list).toHaveBeenCalledTimes(3)
  complete(pending[0])
  await new Promise(resolve => setImmediate(resolve))
  expect(database.list).toHaveBeenCalledTimes(4)
  expect(pending[3].ids).toHaveLength(10)
  complete(pending[3])
  releaseDepartments([{ _id: 'department', name: 'People' }])
  const populated = await result
  expect(populated.map(record => record._id)).toEqual(records.map(record => record._id))
  expect(populated[99]).toMatchObject({ department: { _id: 'department', name: 'People' }, userId: { _id: 'user-99', email: '99@example.test', role: 'employee' } })
  expect(populated[99].userId.password).toBeUndefined()
})

test('roster pagination continues within each user batch and propagates failures', async () => {
  const database = {
    getMany: jest.fn(),
    list: jest.fn().mockResolvedValueOnce({ records: [{ _id: 'older', employeeId: 'e', role: 'employee' }], nextCursor: 'next' })
      .mockResolvedValueOnce({ records: [{ _id: 'newer', employeeId: 'e', role: 'hr' }], nextCursor: null }),
  }
  expect((await populateEmployeeRoster(database, [{ _id: 'e' }]))[0].userId).toEqual({ _id: 'newer', role: 'hr' })
  expect(database.list.mock.calls[1][1].cursor).toBe('next')
  database.list.mockRejectedValueOnce(new Error('Unavailable'))
  await expect(populateEmployeeRoster(database, [{ _id: 'e' }])).rejects.toThrow('Unavailable')
  expect(await populateEmployeeRoster(database, [])).toEqual([])
})
