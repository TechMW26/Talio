jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/cache', () => ({ buildCachePattern: jest.fn(args => JSON.stringify(args)), clearCachePattern: jest.fn().mockResolvedValue() }))
jest.mock('@/lib/gemini', () => ({ generateContent: jest.fn() }))

const { POST } = require('@/app/api/leave/balance/bulk-import/route')
const { getAuthAndDatabase } = require('@/lib/auth')
const { generateContent } = require('@/lib/gemini')
const { clearCachePattern, buildCachePattern } = require('@/lib/cache')
const { workflowStore } = require('../helpers/firestoreWorkflowStore')

const EMPLOYEE_ID = '111111111111111111111111'
const LEAVE_TYPE_ID = '222222222222222222222222'

const file = (content, name = 'import.csv') => new File([content], name, { type: 'text/csv' })
const requestWith = (fields = {}) => {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    fd.append(key, value)
  }
  return new Request('https://talio.test/api/leave/balance/bulk-import', { method: 'POST', body: fd })
}

const mockAuth = database => {
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { role: 'hr' }, tenant: { databaseName: 'tenant-a' }, database })
}

describe('leave balance bulk import', () => {
  let database
  beforeEach(() => {
    jest.clearAllMocks()
    database = workflowStore({
      employees: [{ _id: EMPLOYEE_ID, status: 'active', firstName: 'John', lastName: 'Doe', employeeCode: 'E1', email: 'john@example.test' }],
      leavetypes: [{ _id: LEAVE_TYPE_ID, isActive: true, code: 'CL', name: 'Casual Leave', maxDaysPerYear: 12 }],
    })
    mockAuth(database)
  })

  test('rejects unauthenticated requests', async () => {
    getAuthAndDatabase.mockResolvedValue({ success: false, message: 'Unauthorized' })
    expect((await POST(requestWith({ mode: 'preview', file: file('a,b') }))).status).toBe(401)
  })

  test('rejects non-manager roles', async () => {
    getAuthAndDatabase.mockResolvedValue({ success: true, user: { role: 'employee' }, database })
    expect((await POST(requestWith({ mode: 'preview', file: file('a,b') }))).status).toBe(403)
  })

  test('rejects an invalid import mode', async () => {
    expect((await POST(requestWith({ mode: 'delete', year: '2026' }))).status).toBe(400)
  })

  test.each(['2026junk', '2026.5', '1899', '10000', '-5'])('rejects invalid year %s before querying the database', async year => {
    const res = await POST(requestWith({ mode: 'preview', file: file('a,b'), year }))
    expect(res.status).toBe(400)
    expect(database.list).not.toHaveBeenCalled()
  })

  test('rejects files larger than 1 MB', async () => {
    const res = await POST(requestWith({ mode: 'preview', file: file(new Uint8Array(1024 * 1024 + 1)) }))
    expect(res.status).toBe(413)
    expect(database.list).not.toHaveBeenCalled()
  })

  test('requires a file in preview mode', async () => {
    const res = await POST(requestWith({ mode: 'preview', year: '2026' }))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toBe('File is required')
  })

  test('rejects an empty file in preview mode', async () => {
    const res = await POST(requestWith({ mode: 'preview', year: '2026', file: file('   \n  ') }))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toBe('File is empty')
  })

  test('rejects when no active employees exist', async () => {
    database = workflowStore({ employees: [], leavetypes: [{ _id: LEAVE_TYPE_ID, isActive: true, code: 'CL', name: 'Casual Leave', maxDaysPerYear: 12 }] })
    mockAuth(database)
    const res = await POST(requestWith({ mode: 'preview', year: '2026', file: file('a,b') }))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toBe('No active employees found')
    expect(generateContent).not.toHaveBeenCalled()
  })

  test('rejects when no active leave types exist', async () => {
    database = workflowStore({ employees: [{ _id: EMPLOYEE_ID, status: 'active', firstName: 'John', lastName: 'Doe' }], leavetypes: [] })
    mockAuth(database)
    const res = await POST(requestWith({ mode: 'preview', year: '2026', file: file('a,b') }))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toBe('No active leave types found')
    expect(generateContent).not.toHaveBeenCalled()
  })

  test('parses fenced AI JSON into a preview summary', async () => {
    generateContent.mockResolvedValue('```json\n[{"employeeId":"' + EMPLOYEE_ID + '","employeeName":"John Doe","employeeCode":"E1","leaveTypeId":"' + LEAVE_TYPE_ID + '","leaveTypeName":"Casual Leave","totalDays":12,"matched":true,"row":1},{"employeeId":null,"leaveTypeId":null,"totalDays":5,"matched":false,"unmatchedEmployee":"Mystery","row":2}]\n```')
    const res = await POST(requestWith({ mode: 'preview', year: '2026', file: file('name,days\nJohn Doe,12') }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(2)
    expect(body.summary).toEqual({ total: 2, matched: 1, unmatched: 1 })
    expect(body.year).toBe(2026)
  })

  test('rejects unparseable AI output', async () => {
    generateContent.mockResolvedValue('this is not json')
    const res = await POST(requestWith({ mode: 'preview', year: '2026', file: file('a,b') }))
    expect(res.status).toBe(400)
  })

  test('rejects AI output that is not an array', async () => {
    generateContent.mockResolvedValue('{"employeeId":"' + EMPLOYEE_ID + '"}')
    const res = await POST(requestWith({ mode: 'preview', year: '2026', file: file('a,b') }))
    expect(res.status).toBe(400)
  })

  test('rejects malformed allocations JSON in apply mode', async () => {
    const res = await POST(requestWith({ mode: 'apply', year: '2026', allocations: 'not-json' }))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toBe('Invalid allocations data')
  })

  test('rejects non-array allocations in apply mode', async () => {
    const res = await POST(requestWith({ mode: 'apply', year: '2026', allocations: '{"a":1}' }))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toBe('Provide at most 2000 allocation rows')
  })

  test('rejects more than 2000 allocation rows', async () => {
    const rows = Array.from({ length: 2001 }, () => ({}))
    const res = await POST(requestWith({ mode: 'apply', year: '2026', allocations: JSON.stringify(rows) }))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toBe('Provide at most 2000 allocation rows')
  })

  test('applies allocations without a file and clears both cache namespaces', async () => {
    const allocations = [
      { employeeId: EMPLOYEE_ID, employeeName: 'John Doe', leaveTypeId: LEAVE_TYPE_ID, totalDays: 12 },
      { employeeId: EMPLOYEE_ID, employeeName: 'John Doe', leaveTypeId: LEAVE_TYPE_ID, totalDays: '8' },
    ]
    const res = await POST(requestWith({ mode: 'apply', year: '2026', allocations: JSON.stringify(allocations) }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.created).toBe(1)
    expect(body.updated).toBe(1)
    expect(body.failed).toBe(0)
    const balances = (await database.list('leavebalances')).records
    expect(balances).toHaveLength(1)
    expect(balances[0]).toMatchObject({ employee: EMPLOYEE_ID, leaveType: LEAVE_TYPE_ID, year: 2026, totalDays: 8 })
    expect(buildCachePattern).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'leave-balance' }))
    expect(buildCachePattern).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'dashboard:unified' }))
    expect(clearCachePattern).toHaveBeenCalledTimes(2)
  })

  test('skips invalid rows and reports errors in row order', async () => {
    const allocations = [
      { employeeId: EMPLOYEE_ID, employeeName: 'John Doe', leaveTypeId: LEAVE_TYPE_ID, totalDays: 10 },
      { employeeId: '999999999999999999999999', employeeName: 'Stranger', leaveTypeId: LEAVE_TYPE_ID, totalDays: 10 },
      { employeeId: EMPLOYEE_ID, employeeName: 'John Doe', leaveTypeId: LEAVE_TYPE_ID, totalDays: -2 },
      { employeeId: EMPLOYEE_ID, employeeName: 'John Doe', leaveTypeId: LEAVE_TYPE_ID, totalDays: 'abc' },
      { employeeId: EMPLOYEE_ID, employeeName: 'John Doe', leaveTypeId: LEAVE_TYPE_ID },
      { employeeId: EMPLOYEE_ID, employeeName: 'John Doe', leaveTypeId: LEAVE_TYPE_ID, totalDays: true },
    ]
    const res = await POST(requestWith({ mode: 'apply', year: '2026', allocations: JSON.stringify(allocations) }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.created).toBe(1)
    expect(body.updated).toBe(0)
    expect(body.failed).toBe(5)
    expect(body.errors).toEqual([
      'Skipped: missing data for Stranger',
      'Invalid days for John Doe: -2',
      'Invalid days for John Doe: abc',
      'Skipped: missing data for John Doe',
      'Invalid days for John Doe: true',
    ])
  })
})
