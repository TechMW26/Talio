jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/cache', () => ({ buildCachePattern: jest.fn(), clearCachePattern: jest.fn() }))
jest.mock('@/lib/leaveAllocation.server', () => ({ EMPLOYED_STATUSES: ['active', 'probation'], ensureEmployeeLeaveBalances: jest.fn(), LEAVE_BALANCE_STORE_OPTIONS: {} }))
const { GET } = require('@/app/api/leave/balance/route')
const { getAuthAndDatabase } = require('@/lib/auth')
const { ensureEmployeeLeaveBalances } = require('@/lib/leaveAllocation.server')
const own = '111111111111111111111111'
const other = '222222222222222222222222'
describe('leave balance scope', () => {
  let database
  beforeEach(() => {
    jest.clearAllMocks()
    database = {
      list: jest.fn(async collection => ({ records: collection === 'employees' ? [{ _id: own }] : [] })),
      getMany: jest.fn(async () => []),
    }
    getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'user', role: 'employee', employeeId: own }, tenant: { databaseName: 'tenant-a' }, database })
  })
  test('prevents another employee balance query', async () => {
    expect((await GET(new Request(`https://talio.test/api/leave/balance?employeeId=${other}`))).status).toBe(403)
    expect(database.list).not.toHaveBeenCalled()
  })
  test('uses employee ID rather than user ID and allocates missing balances', async () => {
    expect((await GET(new Request('https://talio.test/api/leave/balance?year=2026'))).status).toBe(200)
    expect(database.list).toHaveBeenCalledWith('leavebalances', expect.objectContaining({ filters: [{ field: 'employee', operator: '==', value: own }, { field: 'year', operator: '==', value: 2026 }] }))
    expect(ensureEmployeeLeaveBalances).toHaveBeenCalledWith({ database, employeeId: own, year: 2026 })
  })
  test('excludes departed employees from HR aggregate', async () => {
    getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'hr', role: 'hr' }, tenant: { databaseName: 'tenant-a' }, database })
    await GET(new Request('https://talio.test/api/leave/balance?year=2026'))
    expect(database.list).toHaveBeenCalledWith('employees', expect.objectContaining({ filters: [{ field: 'status', operator: 'in', value: ['active', 'probation'] }] }))
    expect(database.list).toHaveBeenCalledWith('leavebalances', expect.objectContaining({ filters: [{ field: 'employee', operator: 'in', value: [own] }, { field: 'year', operator: '==', value: 2026 }] }))
  })
  test.each(['2026junk', 'NaN', '2026.5'])('rejects invalid year %s', async year => {
    expect((await GET(new Request(`https://talio.test/api/leave/balance?year=${year}`))).status).toBe(400)
  })
})
