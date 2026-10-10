import { GET } from '@/app/api/dashboard/leave-requests/route'
import { dashboardAuth } from '@/lib/dashboardData.server'
import { resolveTeamViewScope } from '@/lib/teamViews.server'
import { getTenantCompanyFeaturePayload } from '@/lib/companyFeatures.server'

jest.mock('@/lib/dashboardData.server', () => ({ dashboardAuth: jest.fn() }))
jest.mock('@/lib/teamViews.server', () => ({ resolveTeamViewScope: jest.fn() }))
jest.mock('@/lib/companyFeatures.server', () => ({ getTenantCompanyFeaturePayload: jest.fn() }))

let database, auth
const request = () => new Request('http://localhost/api/dashboard/leave-requests')
const leave = (employee = 'report') => ({ _id: 'leave-1', employee, leaveType: 'annual', status: 'pending', numberOfDays: 2, createdAt: new Date('2026-10-01'), reason: 'Private reason' })
beforeEach(() => {
  jest.clearAllMocks()
  database = {
    databaseName: 'tenant-a',
    list: jest.fn(async () => ({ records: [leave()], nextCursor: 'more' })),
    getMany: jest.fn(async (collection, ids) => ids.map(_id => collection === 'employees' ? { _id, firstName: 'Test', lastName: 'Employee', salary: 123 } : { _id, name: 'Annual' })),
  }
  auth = { user: { _id: 'account', role: 'admin', employeeId: 'self' }, tenant: { companySlug: 'company-a' }, database }
  dashboardAuth.mockResolvedValue(auth)
  getTenantCompanyFeaturePayload.mockResolvedValue({ features: { leaveManagement: true } })
  resolveTeamViewScope.mockResolvedValue({ members: [{ _id: 'self' }, { _id: 'report' }] })
})

test.each(['admin', 'hr'])('%s receives pending rows using one bounded indexed read, without a roster scan', async role => {
  auth.user.role = role
  const response = await GET(request())
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ success: true, data: [{ _id: 'leave-1', status: 'pending', numberOfDays: 2, employee: { _id: 'report', firstName: 'Test', lastName: 'Employee' }, leaveType: { _id: 'annual', name: 'Annual' } }] })
  expect(database.list).toHaveBeenCalledTimes(1)
  expect(database.list).toHaveBeenCalledWith('leaves', { filters: [{ field: 'status', operator: '==', value: 'pending' }], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 5 })
  expect(resolveTeamViewScope).not.toHaveBeenCalled()
  expect(database.getMany).toHaveBeenCalledTimes(2)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
})

test('manager reads only authorized reports, excluding self', async () => {
  auth.user.role = 'manager'
  const result = await (await GET(request())).json()
  expect(result.data).toHaveLength(1)
  expect(resolveTeamViewScope).toHaveBeenCalledWith(database, auth.user, { organization: false })
  expect(database.list.mock.calls[0][1].filters).toContainEqual({ field: 'employee', operator: 'in', value: ['report'] })
  expect(result.data[0]).not.toHaveProperty('reason')
  expect(result.data[0].employee).not.toHaveProperty('salary')
})

test('empty scoped team never becomes an unfiltered organization query', async () => {
  auth.user.role = 'manager'
  resolveTeamViewScope.mockResolvedValue({ members: [{ _id: 'self' }] })
  expect(await (await GET(request())).json()).toEqual({ success: true, data: [], view: 'recent' })
  expect(database.list).not.toHaveBeenCalled()
})

test('large team queries keep per-batch limits and hydrate only the global newest five', async () => {
  auth.user.role = 'manager'
  resolveTeamViewScope.mockResolvedValue({ members: Array.from({ length: 270 }, (_, n) => ({ _id: `report-${n}` })) })
  let active = 0, maxActive = 0
  database.list.mockImplementation(async (_, options) => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await Promise.resolve()
    active -= 1
    const ids = options.filters.find(item => item.field === 'employee').value
    return { records: ids.slice(0, 5).map(employee => ({ ...leave(employee), _id: `leave-${employee}`, createdAt: new Date(2026, 9, Number(employee.split('-')[1]) + 1) })) }
  })
  const result = await (await GET(request())).json()
  expect(result.data).toHaveLength(5)
  expect(database.list).toHaveBeenCalledTimes(3)
  expect(maxActive).toBeLessThanOrEqual(3)
  expect(database.list.mock.calls.every(([, options]) => options.limit === 5)).toBe(true)
  expect(database.list.mock.calls.every(([, options]) => options.filters.find(item => item.field === 'employee').value.length <= 100)).toBe(true)
  expect(database.getMany.mock.calls.find(([collection]) => collection === 'employees')[1]).toHaveLength(5)
  expect(database.getMany).toHaveBeenCalledWith('leavetypes', ['annual'])
  expect(result.data.map(row => +new Date(row.createdAt))).toEqual(result.data.map(row => +new Date(row.createdAt)).sort((a, b) => b - a))
})

test('disabled leave feature performs no leave or employee query', async () => {
  getTenantCompanyFeaturePayload.mockResolvedValue({ features: { leaveManagement: false } })
  expect(await (await GET(request())).json()).toEqual({ success: true, data: [], view: 'pending' })
  expect(database.list).not.toHaveBeenCalled()
  expect(database.getMany).not.toHaveBeenCalled()
})

test.each([
  { role: 'employee', employeeId: 'self' },
  { role: 'manager' },
])('unauthorized actor fails closed: %j', async user => {
  auth.user = user
  expect((await GET(request())).status).toBe(403)
  expect(database.list).not.toHaveBeenCalled()
})

test('missing actor and invalid login fail closed', async () => {
  auth.user = null
  expect((await GET(request())).status).toBe(401)
  dashboardAuth.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
  expect((await GET(request())).status).toBe(401)
  expect(database.list).not.toHaveBeenCalled()
})

test('query failure is an error, not a misleading empty success', async () => {
  database.list.mockRejectedValue(new Error('Sensitive provider diagnostics'))
  const response = await GET(request())
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ success: false, message: 'Failed to fetch leave requests' })
})

test('native widget hot paths have scoped partial Mongo indexes', () => {
  const { RECORD_INDEXES, PREFIX } = require('../../scripts/mongodb-migration/indexes.cjs')
  for (const name of ['talio_created_v1', 'talio_status_created_v1', 'talio_employee_created_v1']) {
    const index = RECORD_INDEXES.find(index => index.name === name)
    expect(Object.fromEntries(Object.entries(index.key).slice(0, 3))).toEqual(PREFIX)
    expect(index.key['envelope.data.createdAt']).toBe(-1)
    expect(index.partialFilterExpression['envelope.data.createdAt']).toEqual({ $exists: true })
  }
})

test('pending results do not trigger a second recent query', async () => {
  const result = await (await GET(request())).json()
  expect(result.view).toBe('pending')
  expect(database.list).toHaveBeenCalledTimes(1)
})

test.each(['admin', 'manager'])('no pending requests returns recent history with the same %s authorization scope', async role => {
  auth.user.role = role
  database.list.mockResolvedValueOnce({ records: [] }).mockResolvedValueOnce({ records: [{ ...leave(), status: 'approved' }] })
  const result = await (await GET(request())).json()
  expect(result.view).toBe('recent')
  expect(result.data[0].status).toBe('approved')
  expect(database.list).toHaveBeenCalledTimes(2)
  expect(database.list.mock.calls[1][1]).toEqual({ filters: role === 'manager' ? [{ field: 'employee', operator: 'in', value: ['report'] }] : [], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 5 })
  expect(resolveTeamViewScope).toHaveBeenCalledTimes(role === 'manager' ? 1 : 0)
})
