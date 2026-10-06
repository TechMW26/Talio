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
db.list = jest.fn(async (collection, { filters = [], limit = 24, cursor } = {}) => {
  const rows = db[collection].filter(row => filters.every(({ field, value, operator }) => operator === 'in' ? value.includes(row[field]) : row[field] === value)).sort((a, b) => a.firstName.localeCompare(b.firstName))
  const start = cursor ? Number(cursor) : 0
  return { records: rows.slice(start, start + limit), nextCursor: start + limit < rows.length ? String(start + limit) : null }
})
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
test('reads and hydrates one cursor page at a time, with server-side search', async () => {
  const original = db.employees
  try {
    db.employees = Array.from({ length: 55 }, (_, index) => ({ _id: `e${index}`, firstName: `Person ${String(index).padStart(2, '0')}`, department: 'd1', status: 'active', email: `person${index}@example.com` }))
    db.list.mockClear()
    getAuthAndDatabase.mockResolvedValue({ success: true, database: db, user: { role: 'admin' } })
    const first = await listTeamMembers({ url: 'http://localhost/api/team/members?limit=24' })
    expect(first.data).toHaveLength(24)
    expect(first.pagination).toEqual({ limit: 24, nextCursor: '24', hasMore: true })
    expect(db.list).toHaveBeenCalledTimes(1)
    const next = await listTeamMembers({ url: `http://localhost/api/team/members?limit=24&cursor=${first.pagination.nextCursor}` })
    expect(next.data).toHaveLength(24)
    expect(next.data.some(row => first.data.some(previous => previous._id === row._id))).toBe(false)
    const last = await listTeamMembers({ url: `http://localhost/api/team/members?limit=24&cursor=${next.pagination.nextCursor}` })
    expect(last.data).toHaveLength(7)
    expect(last.pagination.hasMore).toBe(false)
    const search = await listTeamMembers({ url: 'http://localhost/api/team/members?search=person54%40example.com' })
    expect(search.data.map(row => row._id)).toEqual(['e54'])
  } finally { db.employees = original }
})
test('pagination applies authorization before returning rows and rejects invalid limits', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: true, database: db, user: { role: 'employee', employeeId: 'head' } })
  const result = await listTeamMembers({ url: 'http://localhost/api/team/members?limit=1' })
  expect(result.data.map(row => row._id)).toEqual(['e1'])
  const next = await listTeamMembers({ url: `http://localhost/api/team/members?limit=1&cursor=${result.pagination.nextCursor}` })
  expect(next.data).toEqual([])
  expect(next.pagination.hasMore).toBe(false)
  await expect(listTeamMembers({ url: 'http://localhost/api/team/members?limit=-2' })).rejects.toThrow('Invalid page size')
})
