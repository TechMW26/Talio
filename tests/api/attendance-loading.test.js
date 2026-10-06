jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreProductivityView.server', () => ({ getProductivityVisibility: jest.fn(), queryProductivityByIds: jest.fn() }))
jest.mock('@/lib/queryCache', () => ({}))
jest.mock('@/lib/cache', () => ({}))
jest.mock('@/lib/activityLogger', () => ({}))
jest.mock('@/lib/mailer', () => ({}))
jest.mock('@/lib/pushNotification', () => ({}))
jest.mock('@/lib/realtimeEvents', () => ({}))
jest.mock('@/lib/roleNews', () => ({}))
jest.mock('@/lib/productivityMosaic', () => ({}))
jest.mock('@/lib/geofencing', () => ({}))
import { GET } from '@/app/api/attendance/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { getProductivityVisibility, queryProductivityByIds } from '@/lib/platform/firestoreProductivityView.server'
import { ATTENDANCE_DATABASE_OPTIONS } from '@/lib/platform/firestoreAttendance.server'
const id = '507f1f77bcf86cd799439011', other = '507f1f77bcf86cd799439012'
let database
beforeEach(() => {
  jest.clearAllMocks()
  database = { get: jest.fn(async (collection, key) => collection === 'employees' ? { _id: key, firstName: 'Test' } : null) }
  getAuthAndDatabase.mockResolvedValue({ success: true, database, user: { _id: 'account', employeeId: id, role: 'employee' } })
  getProductivityVisibility.mockResolvedValue({ employees: [{ _id: id }] })
  queryProductivityByIds.mockResolvedValue([{ _id: 'record', employee: id, date: new Date('2026-10-04T00:00:00Z'), status: 'present' }])
})
const request = query => new Request(`https://talio.test/api/attendance?${query}`)
test.each(['1', '01', '10', '12'])('accepts calendar month %s and returns attendance', async month => {
  const response = await GET(request(`employeeId=${id}&month=${month}&year=2026`))
  expect(response.status).toBe(200)
  expect((await response.json()).data[0].status).toBe('present')
  expect(getProductivityVisibility).not.toHaveBeenCalled()
  expect(database.get).toHaveBeenCalledTimes(1)
})
test.each(['month=0&year=2026', 'month=13&year=2026', 'month=abc&year=2026', 'month=10&year=nope', 'month=10', 'year=2026'])('rejects malformed filters: %s', async query => {
  expect((await GET(request(query))).status).toBe(400)
  expect(queryProductivityByIds).not.toHaveBeenCalled()
})
test('uses inclusive timezone-correct month boundaries, including leap years', async () => {
  await GET(request(`employeeId=${id}&month=2&year=2024`))
  const filters = queryProductivityByIds.mock.calls[0][4]
  expect(filters.map(f => f.value.toISOString())).toEqual(['2024-01-31T18:30:00.000Z', '2024-02-29T18:29:59.999Z'])
})
test('does not expose another employee without hierarchy access', async () => {
  const response = await GET(request(`employeeId=${other}&month=10&year=2026`))
  expect((await response.json()).data).toEqual([])
  expect(getProductivityVisibility).toHaveBeenCalled()
  expect(queryProductivityByIds).not.toHaveBeenCalled()
})
test('daily requests remain supported', async () => {
  expect((await GET(request(`employeeId=${id}&date=2026-10-04`))).status).toBe(200)
})
test('admin lookup stays tenant-bound and avoids loading the roster', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: true, database, user: { _id: 'admin', role: 'admin' } })
  await GET(request(`employeeId=${other}&month=10&year=2026`))
  expect(database.get).toHaveBeenCalledWith('employees', other)
  expect(getProductivityVisibility).not.toHaveBeenCalled()
  expect(queryProductivityByIds).toHaveBeenCalledWith(database, 'attendances', 'employee', [other], expect.any(Array))
})
test('department heads retain hierarchy-scoped access to reports', async () => {
  getProductivityVisibility.mockResolvedValue({ employees: [{ _id: other }] })
  await GET(request(`employeeId=${other}&month=10&year=2026`))
  expect(getProductivityVisibility).toHaveBeenCalledWith(database, expect.any(Object), { includeSelf: true })
  expect(queryProductivityByIds).toHaveBeenCalledWith(database, 'attendances', 'employee', [other], expect.any(Array))
})
test('unauthenticated requests never query attendance', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: false, message: 'Unauthorized' })
  expect((await GET(request('month=10&year=2026'))).status).toBe(401)
  expect(queryProductivityByIds).not.toHaveBeenCalled()
})
test('department hierarchy queries have an explicit schema', () => {
  expect(ATTENDANCE_DATABASE_OPTIONS.queryFields.departments).toContain('parentDepartment')
})
test('shared company settings are fetched once per attendance response', async () => {
  getProductivityVisibility.mockResolvedValue({ employees: [{ _id: id, company: 'company-a' }, { _id: other, company: 'company-a' }] })
  await GET(request('month=10&year=2026'))
  expect(database.get.mock.calls.filter(([collection]) => collection === 'companies')).toEqual([['companies', 'company-a']])
})
