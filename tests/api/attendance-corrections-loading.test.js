import { GET } from '@/app/api/attendance/corrections/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { getProductivityVisibility, queryProductivityByIds } from '@/lib/platform/firestoreProductivityView.server'
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreProductivityView.server', () => ({ getProductivityVisibility: jest.fn(), queryProductivityByIds: jest.fn(), getManyProductivityRecords: async (store, collection, ids) => store.getMany(collection, [...new Set(ids.filter(Boolean))]) }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({}))
jest.mock('@/lib/platform/firestoreAttendanceCorrections.server', () => ({}))
jest.mock('@/lib/eventBus', () => ({}))
jest.mock('@/lib/queryCache', () => ({}))
const own = '507f1f77bcf86cd799439011', other = '507f1f77bcf86cd799439012'
let database
beforeEach(() => {
  jest.clearAllMocks()
  database = { get: jest.fn(async (_, id) => ({ _id: id })), getMany: jest.fn(async (_, ids) => ids.map(_id => ({ _id }))) }
  getAuthAndDatabase.mockResolvedValue({ success: true, database, user: { employeeId: own } })
  queryProductivityByIds.mockResolvedValue([])
  getProductivityVisibility.mockResolvedValue({ employees: [{ _id: other }] })
})
test('my corrections reads only the current employee, not the org chart', async () => {
  expect((await GET(new Request('https://talio.test/api/attendance/corrections?type=my'))).status).toBe(200)
  expect(database.get).toHaveBeenCalledWith('employees', own)
  expect(getProductivityVisibility).not.toHaveBeenCalled()
  expect(queryProductivityByIds).toHaveBeenCalledWith(database, 'attendancecorrections', 'employee', [own], [])
})
test('my scope cannot be overridden with another employee ID', async () => {
  await GET(new Request(`https://talio.test/api/attendance/corrections?type=my&employeeId=${other}`))
  expect(queryProductivityByIds).toHaveBeenCalledWith(database, 'attendancecorrections', 'employee', [], [])
})
test('pending team corrections still require hierarchy visibility', async () => {
  await GET(new Request('https://talio.test/api/attendance/corrections?type=pending'))
  expect(getProductivityVisibility).toHaveBeenCalled()
  expect(queryProductivityByIds).toHaveBeenCalledWith(database, 'attendancecorrections', 'employee', [other], [{ field: 'status', operator: '==', value: 'pending' }])
})
test('repeated reviewers and attendance references are hydrated once per unique record', async () => {
  queryProductivityByIds.mockResolvedValue(Array.from({ length: 50 }, (_, i) => ({ _id: String(i), employee: own, reviewedBy: 'reviewer', attendance: 'day' })))
  const response=await GET(new Request('https://talio.test/api/attendance/corrections?type=my'))
  expect((await response.json()).data).toHaveLength(50)
  expect(database.getMany.mock.calls).toEqual([['employees', ['reviewer']], ['attendances', ['day']]])
  expect(database.get).toHaveBeenCalledTimes(1)
})
