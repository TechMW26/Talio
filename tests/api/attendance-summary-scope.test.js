import { GET } from '@/app/api/attendance/summary/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { getProductivityVisibility, queryProductivityByIds } from '@/lib/platform/firestoreProductivityView.server'

jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreProductivityView.server', () => ({ getProductivityVisibility: jest.fn(), queryProductivityByIds: jest.fn() }))

let database
beforeEach(() => {
  jest.clearAllMocks()
  database = { get: jest.fn(async (_, id) => ({ _id: id })) }
  getAuthAndDatabase.mockResolvedValue({ success: true, database, user: { _id: 'account', employeeId: 'self', role: 'employee' } })
  getProductivityVisibility.mockResolvedValue({ employees: [{ _id: 'self' }] })
  queryProductivityByIds.mockResolvedValue([])
})
const request = employee => new Request(`http://localhost/api/attendance/summary?employeeId=${employee}`)

test('self summary reads only the tenant-bound employee without loading the full roster', async () => {
  const response = await GET(request('self'))
  expect(response.status).toBe(200)
  expect(database.get).toHaveBeenCalledWith('employees', 'self')
  expect(getProductivityVisibility).not.toHaveBeenCalled()
  expect(queryProductivityByIds).toHaveBeenCalledWith(database, 'attendances', 'employee', ['self'], expect.any(Array))
})
test('admin summary reads a requested employee in the authorized tenant', async () => {
  getAuthAndDatabase.mockResolvedValue({ success: true, database, user: { _id: 'account', employeeId: 'self', role: 'admin' } })
  expect((await GET(request('other'))).status).toBe(200)
  expect(database.get).toHaveBeenCalledWith('employees', 'other')
  expect(getProductivityVisibility).not.toHaveBeenCalled()
})
test('non-admin cannot use the direct lookup for another employee', async () => {
  expect((await GET(request('other'))).status).toBe(403)
  expect(database.get).not.toHaveBeenCalled()
  expect(getProductivityVisibility).toHaveBeenCalled()
  expect(queryProductivityByIds).not.toHaveBeenCalled()
})
test('manager access still uses current hierarchy visibility', async () => {
  getProductivityVisibility.mockResolvedValue({ employees: [{ _id: 'report' }] })
  expect((await GET(request('report'))).status).toBe(200)
  expect(database.get).not.toHaveBeenCalled()
  expect(queryProductivityByIds).toHaveBeenCalledWith(database, 'attendances', 'employee', ['report'], expect.any(Array))
})
test('missing employee in the current tenant does not fall back to another tenant', async () => {
  database.get.mockResolvedValue(null)
  expect((await GET(request('self'))).status).toBe(403)
  expect(queryProductivityByIds).not.toHaveBeenCalled()
})
