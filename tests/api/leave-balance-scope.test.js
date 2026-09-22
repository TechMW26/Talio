jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/cache', () => ({ buildCacheKey: jest.fn(args => JSON.stringify(args)), getCache: jest.fn(), setCache: jest.fn() }))
jest.mock('@/lib/leaveAllocation.server', () => ({ EMPLOYED_STATUSES: ['active', 'probation'], ensureEmployeeLeaveBalances: jest.fn() }))
const { GET } = require('@/app/api/leave/balance/route')
const { getAuthAndModels } = require('@/lib/auth')
const { ensureEmployeeLeaveBalances } = require('@/lib/leaveAllocation.server')
const own = '111111111111111111111111'
const other = '222222222222222222222222'
function query(value) {
  const q = { lean: async () => value }
  for (const method of ['select', 'populate']) q[method] = () => q
  return q
}
describe('leave balance scope', () => {
  let models
  beforeEach(() => {
    jest.clearAllMocks()
    models = {
      Employee: { find: jest.fn(() => query([{ _id: own }])), findOne: jest.fn(() => query({ _id: own })) },
      LeaveBalance: { find: jest.fn(() => query([])) },
    }
    getAuthAndModels.mockResolvedValue({ success: true, user: { _id: 'user', role: 'employee', employeeId: own }, tenant: { databaseName: 'tenant-a' }, models })
  })
  test('prevents another employee balance query', async () => {
    expect((await GET(new Request(`https://talio.test/api/leave/balance?employeeId=${other}`))).status).toBe(403)
    expect(models.LeaveBalance.find).not.toHaveBeenCalled()
  })
  test('uses employee ID rather than user ID and allocates missing balances', async () => {
    expect((await GET(new Request('https://talio.test/api/leave/balance?year=2026'))).status).toBe(200)
    expect(models.LeaveBalance.find).toHaveBeenCalledWith({ employee: own, year: 2026 })
    expect(ensureEmployeeLeaveBalances).toHaveBeenCalledWith({ models, employeeId: own, year: 2026 })
  })
  test('excludes departed employees from HR aggregate', async () => {
    getAuthAndModels.mockResolvedValue({ success: true, user: { _id: 'hr', role: 'hr' }, tenant: { databaseName: 'tenant-a' }, models })
    await GET(new Request('https://talio.test/api/leave/balance?year=2026'))
    expect(models.Employee.find).toHaveBeenCalledWith({ status: { $in: ['active', 'probation'] } })
    expect(models.LeaveBalance.find).toHaveBeenCalledWith({ employee: { $in: [own] }, year: 2026 })
  })
  test.each(['2026junk', 'NaN', '2026.5'])('rejects invalid year %s', async year => {
    expect((await GET(new Request(`https://talio.test/api/leave/balance?year=${year}`))).status).toBe(400)
  })
})
