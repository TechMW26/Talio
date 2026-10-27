const mockAfter = []
jest.mock('next/server', () => ({
  after: fn => mockAfter.push(fn),
  NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status || 200, headers: options.headers }) },
}))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreAttendancePunch.server', () => ({ saveAttendancePunch: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/queryCache', () => ({ __esModule: true, default: { clearPattern: jest.fn() } }))
jest.mock('@/lib/cache', () => ({ buildCachePattern: jest.fn(x => JSON.stringify(x)), clearCachePattern: jest.fn() }))
jest.mock('@/lib/activityLogger', () => ({ logActivity: jest.fn() }))
jest.mock('@/lib/mailer', () => ({ sendEmail: jest.fn() }))
jest.mock('@/lib/pushNotification', () => ({ sendPushToUser: jest.fn() }))
jest.mock('@/lib/realtimeEvents', () => ({ emitAttendanceUpdate: jest.fn(), emitDashboardRefresh: jest.fn(), emitRealtimeEvent: jest.fn(), REALTIME_EVENTS: {} }))
jest.mock('@/lib/roleNews', () => ({ buildSearchQuery: jest.fn(), fetchRoleNews: jest.fn() }))
jest.mock('@/lib/productivityMosaic', () => ({ createDailyMosaicOnCheckout: jest.fn() }))
jest.mock('@/lib/geofencing', () => ({ evaluateEmployeeGeofence: jest.fn(), toGeofenceResponse: x => x }))
jest.mock('@/lib/geocoding', () => ({ ...jest.requireActual('@/lib/geocoding'), reverseGeocode: jest.fn() }))

import { POST } from '@/app/api/attendance/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { saveAttendancePunch } from '@/lib/platform/firestoreAttendancePunch.server'
import { evaluateEmployeeGeofence } from '@/lib/geofencing'

const employeeId = '507f1f77bcf86cd799439011'
const companyId = '507f1f77bcf86cd799439022'
const SATURDAY_IST_NOON = '2026-10-24T06:30:00Z'

const request = () => new Request('https://talio.test/api/attendance', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ employeeId, type: 'clock-in', latitude: 0, longitude: 0, accuracy: 20, locationSource: 'gps' }),
})

const company = workingDays => ({
  _id: companyId,
  timezone: 'Asia/Kolkata',
  workingHours: { checkInTime: '09:00', checkOutTime: '18:00', lateThresholdMinutes: 15, fullDayHours: 8, halfDayHours: 4, workingDays },
})

const employee = {
  _id: employeeId,
  userId: 'user1',
  email: 'synthetic@example.invalid',
  firstName: 'Synthetic',
  status: 'active',
}

function setupDatabase(companyRecord) {
  return {
    databaseName: 'talio_company_test',
    get: jest.fn(async (collection) => collection === 'employees' ? employee : null),
    list: jest.fn(async (collection) => ({
      records: collection === 'companies' ? [companyRecord] : collection === 'companysettings' ? [{ timezone: 'Asia/Kolkata', workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] }] : [],
      nextCursor: null,
    })),
    mutate: jest.fn(),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAfter.length = 0
  jest.useFakeTimers()
  jest.setSystemTime(new Date(SATURDAY_IST_NOON))
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  saveAttendancePunch.mockImplementation(async () => ({ _id: '507f1f77bcf86cd799439012', employee: employeeId, checkIn: new Date() }))
  evaluateEmployeeGeofence.mockResolvedValue({ enabled: false, allowed: true, withinGeofence: false })
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

function authenticate(database) {
  getAuthAndDatabase.mockResolvedValue({
    success: true,
    user: { _id: 'user1', employeeId },
    database,
    tenant: { databaseName: database.databaseName },
  })
}

test('employee without a company link inherits the company Saturday and can clock in', async () => {
  authenticate(setupDatabase(company(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'])))

  const response = await POST(request())

  expect(response.status).toBe(200)
  expect((await response.json()).success).toBe(true)
  expect(saveAttendancePunch).toHaveBeenCalledTimes(1)
})

test('numeric working-day configs keep Saturday open', async () => {
  authenticate(setupDatabase(company([1, 2, 3, 4, 5, 6])))

  expect((await POST(request())).status).toBe(200)
  expect(saveAttendancePunch).toHaveBeenCalledTimes(1)
})

test('Saturday stays blocked with an actionable message when it is not configured', async () => {
  authenticate(setupDatabase(company(['monday', 'tuesday', 'wednesday', 'thursday', 'friday'])))

  const response = await POST(request())
  const body = await response.json()

  expect(response.status).toBe(403)
  expect(body.reason).toBe('non_working_day')
  expect(body.message).toContain('Working Days')
  expect(saveAttendancePunch).not.toHaveBeenCalled()
})
