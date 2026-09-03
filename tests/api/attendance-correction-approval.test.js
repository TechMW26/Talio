jest.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(data, init = {}) {
      const headers = new Headers(init.headers || {})
      if (!headers.has('content-type')) headers.set('content-type', 'application/json')
      return new MockNextResponse(JSON.stringify(data), {
        ...init,
        headers,
        status: init.status || 200,
      })
    }
  }

  return { NextResponse: MockNextResponse }
})

jest.mock('@/lib/auth', () => ({
  getAuthAndModels: jest.fn(),
}))

jest.mock('@/lib/queryCache', () => ({
  __esModule: true,
  default: { clearPattern: jest.fn() },
}))

jest.mock('@/lib/eventBus', () => ({
  EVENTS: { ATTENDANCE_CORRECTION_CHANGED: 'attendance.correction.changed' },
  emitEvent: jest.fn(),
}))

jest.mock('@/lib/teamScope', () => ({
  isDirectReport: jest.fn(() => false),
}))

const fs = require('fs')
const path = require('path')
const { getAuthAndModels } = require('@/lib/auth')
const { PATCH: processCorrection } = require('@/app/api/attendance/corrections/route')

const CORRECTION_ID = '6957b35cbf0b9ea49ca507a1'
const ATTENDANCE_ID = '6957b35cbf0b9ea49ca507a2'
const EMPLOYEE_ID = '6957b35cbf0b9ea49ca507a3'
const REVIEWER_ID = '6957b35cbf0b9ea49ca507a4'
const USER_ID = '6957b35cbf0b9ea49ca507a5'

function queryWithLean(value) {
  return { lean: jest.fn().mockResolvedValue(value) }
}

function createApprovalModels({ checkOut = new Date('2026-09-03T12:30:00.000Z') } = {}) {
  const correction = {
    _id: CORRECTION_ID,
    employee: EMPLOYEE_ID,
    attendance: ATTENDANCE_ID,
    status: 'pending',
    requestedCheckIn: new Date('2026-09-03T04:30:00.000Z'),
    requestedCheckOut: checkOut,
    reason: 'Correct shift timings',
    save: jest.fn().mockResolvedValue(undefined),
  }
  const attendance = {
    _id: ATTENDANCE_ID,
    employee: EMPLOYEE_ID,
    checkIn: new Date('2026-09-03T06:23:00.000Z'),
    checkOut,
    status: 'in-progress',
    autoCheckedOut: true,
    autoCheckoutReason: 'Midnight auto-checkout (Asia/Kolkata)',
    autoCheckoutAt: new Date('2026-09-03T18:30:00.000Z'),
    save: jest.fn(),
  }
  const savedAttendance = {
    ...attendance,
    checkIn: correction.requestedCheckIn,
    checkOut,
    status: checkOut ? 'present' : 'in-progress',
    workHours: checkOut ? 8 : 0,
    autoCheckedOut: false,
    autoCheckoutReason: null,
    autoCheckoutAt: null,
  }

  const fullUserQuery = {
    populate: jest.fn(() => fullUserQuery),
    lean: jest.fn().mockResolvedValue({ role: 'admin', employeeId: { _id: REVIEWER_ID } }),
  }
  const employeeUserQuery = {
    select: jest.fn(() => queryWithLean({ _id: USER_ID })),
  }
  const attendanceUpdateQuery = queryWithLean(savedAttendance)

  const models = {
    User: {
      findById: jest.fn(() => fullUserQuery),
      findOne: jest.fn(() => employeeUserQuery),
    },
    Employee: {},
    Department: {},
    Attendance: {
      findById: jest.fn().mockResolvedValue(attendance),
      findByIdAndUpdate: jest.fn(() => attendanceUpdateQuery),
    },
    AttendanceCorrection: {
      findById: jest.fn().mockResolvedValue(correction),
    },
    CompanySettings: {
      findOne: jest.fn(() => queryWithLean({ fullDayHours: 8, halfDayHours: 4, breakTimings: [] })),
    },
  }

  return { attendance, correction, models }
}

async function approve(models) {
  getAuthAndModels.mockResolvedValue({
    success: true,
    user: { _id: USER_ID, role: 'admin' },
    tenant: { databaseName: 'talio_company_test' },
    models,
  })

  return processCorrection(new Request('http://localhost/api/attendance/corrections', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ correctionId: CORRECTION_ID, action: 'approve' }),
  }))
}

describe('attendance correction approval', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('approves a legacy auto-checkout row without full-document validation', async () => {
    const { attendance, correction, models } = createApprovalModels()
    const response = await approve(models)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(attendance.save).not.toHaveBeenCalled()
    expect(models.Attendance.findByIdAndUpdate).toHaveBeenCalledWith(
      ATTENDANCE_ID,
      { $set: expect.objectContaining({
        status: 'present',
        source: 'correction',
        autoCheckedOut: false,
        autoCheckoutReason: null,
        autoCheckoutAt: null,
      }) },
      { new: true, runValidators: true }
    )
    expect(correction.status).toBe('approved')
    expect(correction.save).toHaveBeenCalledTimes(1)
  })

  test('keeps a check-in-only correction in progress', async () => {
    const { models } = createApprovalModels({ checkOut: null })
    const response = await approve(models)

    expect(response.status).toBe(200)
    expect(models.Attendance.findByIdAndUpdate).toHaveBeenCalledWith(
      ATTENDANCE_ID,
      { $set: expect.objectContaining({ status: 'in-progress', workHours: 0 }) },
      { new: true, runValidators: true }
    )
  })

  test('the midnight cleanup writer persists the schema enum code', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/api/cron/daily-productivity-cleanup/route.js'), 'utf8')

    expect(source).toContain("autoCheckoutReason: 'midnight_cutoff'")
    expect(source).not.toContain('autoCheckoutReason: `Midnight auto-checkout')
  })
})
