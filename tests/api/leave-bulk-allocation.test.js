jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/cache', () => ({ buildCachePattern: jest.fn(args => JSON.stringify(args)), clearCachePattern: jest.fn() }))
const { POST } = require('@/app/api/leave/balance/bulk-allocate/route')
const { getAuthAndModels } = require('@/lib/auth')
const { prorateAnnualLeave } = require('@/lib/leaveData')

describe('bulk leave allocation', () => {
  let models
  beforeEach(() => {
    jest.clearAllMocks()
    models = {
      Employee: { find: jest.fn().mockResolvedValue([{ _id: 'employee', dateOfJoining: '2026-07-01' }]) },
      LeaveType: { find: jest.fn().mockResolvedValue([{ _id: 'annual', maxDaysPerYear: 24 }]) },
      LeaveBalance: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn() },
    }
    getAuthAndModels.mockResolvedValue({ success: true, user: { role: 'hr' }, tenant: { databaseName: 'tenant-a' }, models })
  })
  const request = year => new Request('https://talio.test/api/leave/balance/bulk-allocate', { method: 'POST', body: JSON.stringify({ year }) })
  test('prorates new joiners and mirrors balance fields', async () => {
    expect((await POST(request(2026))).status).toBe(200)
    const expected = prorateAnnualLeave(24, '2026-07-01', 2026)
    expect(models.LeaveBalance.create).toHaveBeenCalledWith(expect.objectContaining({ year: 2026, totalDays: expected, allocated: expected, remainingDays: expected }))
  })
  test('preserves existing HR-adjusted balances', async () => {
    models.LeaveBalance.findOne.mockResolvedValue({ totalDays: 15 })
    expect((await (await POST(request(2026))).json()).skipped).toBe(1)
    expect(models.LeaveBalance.create).not.toHaveBeenCalled()
  })
  test.each([null, '', '2026junk', 2026.5, 10000])('rejects invalid year %s before querying employees', async year => {
    expect((await POST(request(year))).status).toBe(400)
    expect(models.Employee.find).not.toHaveBeenCalled()
  })
  test('rejects employees', async () => {
    getAuthAndModels.mockResolvedValue({ success: true, user: { role: 'employee' }, models })
    expect((await POST(request(2026))).status).toBe(403)
  })
})
