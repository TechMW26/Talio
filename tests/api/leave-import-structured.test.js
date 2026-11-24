jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/cache', () => ({ buildCachePattern: jest.fn(), clearCachePattern: jest.fn().mockResolvedValue() }))
jest.mock('@/lib/gemini', () => ({ generateContent: jest.fn() }))

const { POST } = require('@/app/api/leave/balance/bulk-import/route')
const { getAuthAndDatabase } = require('@/lib/auth')
const { generateContent } = require('@/lib/gemini')
const { workflowStore } = require('../helpers/firestoreWorkflowStore')
const { parseStructuredLeaveImport, splitCsvLine } = require('@/lib/leaveImportParser')

const employees = [
  { _id: 'e1', status: 'active', firstName: 'Rukhaya', lastName: 'Rushda', employeeCode: 'D156' },
  { _id: 'e2', status: 'active', firstName: 'Alisha', lastName: 'Perween', employeeCode: 'D73' },
]
const leaveTypes = [
  { _id: 'cl', isActive: true, code: 'CL', name: 'Casual Leave' },
  { _id: 'sl', isActive: true, code: 'SL', name: 'Sick Leave' },
  { _id: 'el', isActive: true, code: 'EL', name: 'Earned Leave' },
]
const CSV = 'Employee Code,Employee Name,Casual Leave,Sick Leave,Earned Leave\nD156,RUKHAYA RUSHDA B A,4.5,5,12\nD73,Alisha Perween,0,3,15\nX9,Ghost,1,1,1'

const request = content => {
  const fd = new FormData()
  fd.append('mode', 'preview'); fd.append('year', '2026')
  fd.append('file', new File([content], 'import.csv', { type: 'text/csv' }))
  return new Request('https://talio.test/api/leave/balance/bulk-import', { method: 'POST', body: fd })
}

describe('structured leave import', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthAndDatabase.mockResolvedValue({ success: true, user: { role: 'hr' }, tenant: { databaseName: 't' }, database: workflowStore({ employees, leavetypes: leaveTypes }) })
  })

  test('splits quoted cells', () => {
    expect(splitCsvLine('a,"b, c","d ""e"""')).toEqual(['a', 'b, c', 'd "e"'])
  })

  test('reads code + leave type columns without AI', async () => {
    const res = await POST(request(CSV))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(generateContent).not.toHaveBeenCalled()
    expect(body.summary).toEqual({ total: 9, matched: 6, unmatched: 3 })
    expect(body.data.find(r => r.employeeId === 'e1' && r.leaveTypeId === 'cl').totalDays).toBe(4.5)
    expect(body.data.find(r => r.unmatchedEmployee === 'X9 (Ghost)')).toBeTruthy()
  })

  test('accepts short codes and Balance suffix, skips title rows', () => {
    const rows = parseStructuredLeaveImport(['LEAVE Balance,,', 'E.ID,CL Balance,SL Balance', 'D73,2,-1'], employees, leaveTypes)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ employeeId: 'e2', leaveTypeId: 'cl', totalDays: 2, matched: true })
    expect(rows[1].matched).toBe(false)
  })

  test('reads HR workbook: all tracker sheets, 2-row header, imports leave taken (Alloted - Balance)', () => {
    const tracker = name => ({ name, rows: [
      ['E.ID', 'Name', 'Designation', 'LEAVE Balance', '', '', 'Current Balance'],
      ['', '', '', 'CL Alloted', 'SL Alloted', 'EL Alloted', 'CL Balance', 'SL Balance', 'EL Balance'],
    ] })
    const dtps = tracker('DTPS Tracker'); dtps.rows.push(['D156', 'RUKHAYA RUSHDA B A', 'Dietitian', 7, 5, 18, 4.5, 5, 12])
    const mwa = tracker('MWA Tracker'); mwa.rows.push(['D73', 'Alisha Perween', 'HC', 7, 5, 18, 0, 3, 15], ['D73', 'Someone Else', 'HC', 7, 5, 18, 1, 1, 1])
    const detail = { name: 'DTPS', rows: [['E.ID', 'Name', 'EL ALLOTED', 'CL ALLOTED', 'Wedding Leave'], ['D156', 'RUKHAYA', 18, 7, 'As Per Company Policy']] }
    const rows = parseStructuredLeaveImport([dtps, mwa, detail], employees, leaveTypes)
    expect(rows).toHaveLength(9)
    expect(rows.filter(r => r.sheet === 'DTPS')).toHaveLength(0)
    expect(rows.find(r => r.employeeId === 'e1' && r.leaveTypeId === 'cl')).toMatchObject({ totalDays: 2.5, importAs: 'taken', leaveTypeName: 'Casual Leave (taken so far, yearly 7)', allottedDays: 7, matched: true })
    expect(rows.find(r => r.employeeId === 'e1' && r.leaveTypeId === 'el')).toMatchObject({ totalDays: 6, importAs: 'taken' })
    const dup = rows.filter(r => r.employeeCode === 'D73')
    expect(dup).toHaveLength(6)
    expect(dup.every(r => !r.matched && /same code/.test(r.unmatchedEmployee))).toBe(true)
  })

  test('balance above allotted is flagged, not imported', () => {
    const rows = parseStructuredLeaveImport(['E.ID,CL Alloted,CL Balance', 'D73,7,9'], employees, leaveTypes)
    expect(rows[0]).toMatchObject({ matched: false, totalDays: -2, importAs: 'taken' })
    expect(rows[0].unmatchedLeaveType).toMatch(/more than allotted/)
  })

  test('balance-only sheets keep the fixed allocation import', () => {
    const rows = parseStructuredLeaveImport(['E.ID,CL Balance', 'D73,3'], employees, leaveTypes)
    expect(rows[0]).toMatchObject({ totalDays: 3, importAs: 'total', leaveTypeName: 'Casual Leave', matched: true })
  })

  test('returns null for files without leave type columns', () => {
    expect(parseStructuredLeaveImport(['name,days', 'John,12'], employees, leaveTypes)).toBeNull()
  })
})
