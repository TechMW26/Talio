jest.mock('@/lib/dashboardData.server', () => ({ DASHBOARD_STORE_OPTIONS: { queryFields: { departments: [], assets: [], announcements: [], policies: [] } } }))
jest.mock('@/lib/projects.server', () => ({ projectId: value => String(value?._id || value || ''), projectFilter: (field, value, operator = '==') => ({ field, value, operator }) }))
jest.mock('@/lib/communicationsStore.server', () => ({ policyApplies: () => true, announcementApplies: () => true }))
import { searchApplicationRecords } from '@/lib/applicationSearch.server'

test('search batches repeated references and retains employee-scoped filters', async () => {
  const database = {
    list: jest.fn(async collection => ({ records: Array.from({ length: 10 }, (_, i) => collection === 'leaves'
      ? { _id: String(i), reason: 'annual', leaveType: 'type-a' }
      : { _id: String(i), title: 'annual', department: 'department-a' }) })),
    getMany: jest.fn(async (collection, ids) => ids.map(_id => ({ _id, collection }))),
  }
  const result = await searchApplicationRecords(database, { role: 'employee' }, { _id: 'employee-a' }, 'annual', path => ['/dashboard/leave', '/dashboard/designations'].includes(path))
  expect(database.getMany.mock.calls).toEqual(expect.arrayContaining([
    ['leavetypes', ['type-a']], ['departments', ['department-a']],
  ]))
  expect(database.getMany).toHaveBeenCalledTimes(2)
  expect(result.leaves).toHaveLength(10)
  expect(result.leaves[0].leaveType._id).toBe('type-a')
  expect(database.list.mock.calls.find(([name]) => name === 'leaves')[1].filters).toContainEqual({ field: 'employee', value: 'employee-a', operator: '==' })
})
test('disabled search sections make no requests', async () => {
  const database = { list: jest.fn(), getMany: jest.fn() }
  await searchApplicationRecords(database, {}, {}, 'annual', () => false)
  expect(database.list).not.toHaveBeenCalled()
  expect(database.getMany).not.toHaveBeenCalled()
})
