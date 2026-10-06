import { listTeamMembers, getTeamMember } from '@/lib/teamViews.server'
import { getAuthAndDatabase } from '@/lib/auth'
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('next/server', () => ({ NextResponse: { json: body => body } }))
jest.mock('@/lib/tasks.server', () => ({ taskHandler: fn => fn }))
jest.mock('@/lib/projects.server', () => ({
  PROJECT_STORE_OPTIONS: { queryFields: { employees: [] } }, projectId: row => typeof row === 'object' ? row?._id : row,
  projectFilter: (field, value, operator = '==') => ({ field, value, operator }),
  projectRows: async (db, collection, filters) => db[collection].filter(row => filters.every(({ field, value, operator }) => operator === 'array-contains' ? (row[field] || []).includes(value) : row[field] === value)),
  projectRecords: async (db, collection, ids) => db[collection].filter(row => ids.includes(row._id)),
  projectFailure: message => { throw new Error(message) },
}))
jest.mock('@/lib/organization.server', () => ({ ORGANIZATION_STORE_OPTIONS: { queryFields: { employees: [] } }, organizationEmployee: async (db, id) => db.employees.find(row => row._id === id) }))
jest.mock('@/lib/leaveRequests.server', () => ({ LEAVE_STORE_OPTIONS: {} }))
jest.mock('@/lib/leaveApi.server', () => ({}))
jest.mock('@/lib/platform/firestoreStore.server', () => ({}))
const db = {
  departments: [{ _id: 'd1', name: 'One', head: 'head', isActive: true }, { _id: 'd2', name: 'Two', isActive: true }],
  teams: [{ _id: 't1', teamName: 'First', department: 'd1', isActive: true }, { _id: 't2', teamName: 'Second', department: 'd2', teamLeaders: ['lead'], isActive: true }],
  employees: [{ _id: 'e1', firstName: 'One', department: 'd1', status: 'active' }, { _id: 'e2', firstName: 'Two', department: 'd2', status: 'active' }],
}
test('admin gets all active department and team choices even when filtered', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: true, database: db, user: { role: 'admin' } })
  const result = await listTeamMembers({ url: 'http://localhost/api/team/members?department=d1' })
  expect(result.data.map(row => row._id)).toEqual(['e1'])
  expect(result.meta.departments.map(row => row._id)).toEqual(['d1', 'd2'])
  expect(result.meta.teams.map(row => row._id)).toEqual(['t1', 't2'])
})
test('department head only sees authorized department and its teams', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: true, database: db, user: { role: 'employee', employeeId: 'head' } })
  const result = await listTeamMembers({ url: 'http://localhost/api/team/members' })
  expect(result.meta.departments.map(row => row._id)).toEqual(['d1'])
  expect(result.meta.teams.map(row => row._id)).toEqual(['t1'])
  await expect(listTeamMembers({ url: 'http://localhost/api/team/members?department=d2' })).rejects.toThrow('Not authorized')
})
test('member details resolve screenshot account only after employee authorization', async () => {
  const list = jest.fn().mockResolvedValue({ records: [{ _id: 'account-one', employeeId: 'e1' }] })
  const store = { ...db, taskassignees: [], tasks: [], list }
  getAuthAndDatabase.mockResolvedValue({ success: true, database: store, user: { role: 'admin' } })
  const result = await getTeamMember({}, { id: 'e1' })
  expect(result.data.employee.userId).toBe('account-one')
  expect(list).toHaveBeenCalledWith('users', { filters: [{ field: 'employeeId', operator: '==', value: 'e1' }], limit: 1 })
  list.mockClear()
  await expect(getTeamMember({}, { id: 'outside-tenant' })).rejects.toThrow('Access denied')
  expect(list).not.toHaveBeenCalled()
})
