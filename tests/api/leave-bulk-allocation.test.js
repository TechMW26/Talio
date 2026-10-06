jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/cache', () => ({ buildCachePattern: jest.fn(args => JSON.stringify(args)), clearCachePattern: jest.fn().mockResolvedValue() }))
const { POST } = require('@/app/api/leave/balance/bulk-allocate/route')
const { getAuthAndDatabase } = require('@/lib/auth')
const { workflowStore } = require('../helpers/firestoreWorkflowStore')
const { prorateAnnualLeave } = require('@/lib/leaveData')

describe('bulk leave allocation', () => {
  let database
  beforeEach(() => {
    jest.clearAllMocks()
    database = workflowStore({ employees: [{ _id: '111111111111111111111111', status: 'active', dateOfJoining: '2026-07-01' }], leavetypes: [{ _id: '222222222222222222222222', isActive: true, maxDaysPerYear: 24 }] })
    getAuthAndDatabase.mockResolvedValue({ success: true, user: { role: 'hr' }, tenant: { databaseName: 'tenant-a' }, database })
  })
  const request = year => new Request('https://talio.test/api/leave/balance/bulk-allocate', { method: 'POST', body: JSON.stringify({ year }) })
  test('prorates new joiners and mirrors balance fields', async () => {
    expect((await POST(request(2026))).status).toBe(200)
    const expected = prorateAnnualLeave(24, '2026-07-01', 2026)
    expect((await database.list('leavebalances')).records[0]).toMatchObject({ year: 2026, totalDays: expected, allocated: expected, remainingDays: expected })
  })
  test('preserves existing HR-adjusted balances', async () => {
    await database.create('leavebalances', { _id: '333333333333333333333333', employee: '111111111111111111111111', leaveType: '222222222222222222222222', year: 2026, totalDays: 15 })
    expect((await (await POST(request(2026))).json()).skipped).toBe(1)
    expect((await database.list('leavebalances')).records).toHaveLength(1)
    expect((await database.list('leavebalances')).records[0].totalDays).toBe(15)
  })
  test.each([null, '', '2026junk', 2026.5, 10000])('rejects invalid year %s before querying employees', async year => {
    expect((await POST(request(year))).status).toBe(400)
    expect(database.list).not.toHaveBeenCalled()
  })
  test('rejects employees', async () => {
    getAuthAndDatabase.mockResolvedValue({ success: true, user: { role: 'employee' }, database })
    expect((await POST(request(2026))).status).toBe(403)
  })
})
