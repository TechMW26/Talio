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
jest.mock('@/lib/geocoding', () => ({ ...jest.requireActual('@/lib/geocoding'), reverseGeocode: jest.fn() }))
jest.mock('@/lib/realtimeEvents', () => ({ emitAttendanceUpdate: jest.fn(), emitDashboardRefresh: jest.fn(), emitRealtimeEvent: jest.fn(), REALTIME_EVENTS: {} }))
jest.mock('@/lib/roleNews', () => ({ buildSearchQuery: jest.fn(), fetchRoleNews: jest.fn() }))
jest.mock('@/lib/productivityMosaic', () => ({ createDailyMosaicOnCheckout: jest.fn() }))
jest.mock('@/lib/geofencing', () => ({ evaluateEmployeeGeofence: jest.fn(), toGeofenceResponse: x => x }))

import { saveAttendancePunch } from '@/lib/platform/firestoreAttendancePunch.server'
import { POST } from '@/app/api/attendance/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { evaluateEmployeeGeofence } from '@/lib/geofencing'
import { reverseGeocode } from '@/lib/geocoding'
import { sendEmail } from '@/lib/mailer'
import { sendPushToUser } from '@/lib/pushNotification'
import { fetchRoleNews } from '@/lib/roleNews'
import { createDailyMosaicOnCheckout } from '@/lib/productivityMosaic'
import { clearCachePattern } from '@/lib/cache'

const employeeId = '507f1f77bcf86cd799439011'
const attendanceId = '507f1f77bcf86cd799439012'
let database, record, employee
const request = (type, overrides = {}) => new Request('https://talio.test/api/attendance', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ employeeId, type, latitude: 0, longitude: 0, accuracy: 20, locationSource: 'gps', ...overrides }),
})

beforeEach(() => {
  jest.clearAllMocks()
  mockAfter.length = 0
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  employee = { _id: employeeId, userId: 'user1', email: 'synthetic@example.invalid', firstName: 'Synthetic' }
  record = { _id: attendanceId, employee: employeeId, checkIn: new Date(Date.now() - 8 * 3600000), location: {} }
  database = {
    databaseName: 'talio_company_test',
    get: jest.fn(async (collection) => collection === 'employees' ? employee : null),
    list: jest.fn(async (collection) => ({ records: collection === 'companysettings' ? [{ workingDays: ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'], timezone: 'Asia/Kolkata' }] : collection === 'attendances' ? (record ? [record] : []) : [], nextCursor: null })),
    mutate: jest.fn(async (collection, id, change) => { record = change(record); return record }),
  }
  saveAttendancePunch.mockImplementation(async (db, { changes }) => {
    record = { ...record, ...changes, _id: attendanceId, employee: employeeId }
    return record
  })
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'user1', employeeId }, database, tenant: { databaseName: database.databaseName } })
  evaluateEmployeeGeofence.mockResolvedValue({ enabled: false, allowed: true, withinGeofence: false })
  // Intentionally hung providers: the response must not await any of them.
  for (const provider of [reverseGeocode, sendEmail, sendPushToUser, fetchRoleNews, createDailyMosaicOnCheckout]) provider.mockImplementation(() => new Promise(() => {}))
  clearCachePattern.mockResolvedValue(undefined)
})
afterEach(() => jest.restoreAllMocks())

test.each(['clock-in', 'clock-out'])('%s returns persisted attendance without waiting for external integrations', async type => {
  if (type === 'clock-in') record = null
  const response = await POST(request(type))
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.success).toBe(true)
  expect(response.headers.get('server-timing')).toMatch(/^attendance;dur=\d+\.\d$/)
  expect(body.data[type === 'clock-in' ? 'checkIn' : 'checkOut']).toBeTruthy()
  expect(saveAttendancePunch).toHaveBeenCalledTimes(1)
  for (const provider of [reverseGeocode, sendEmail, sendPushToUser, fetchRoleNews, createDailyMosaicOnCheckout]) expect(provider).not.toHaveBeenCalled()
  expect(mockAfter.length).toBe(type === 'clock-in' ? 2 : 3)
  expect(clearCachePattern).toHaveBeenCalledTimes(4)
})

test('geofence rejection cannot save a punch or schedule follow-ups', async () => {
  record = null
  evaluateEmployeeGeofence.mockResolvedValue({ enabled: true, allowed: false, code: 'OUTSIDE_GEOFENCE', message: 'Outside' })
  expect((await POST(request('clock-in'))).status).toBe(403)
  expect(saveAttendancePunch).not.toHaveBeenCalled()
  expect(mockAfter).toHaveLength(0)
})

test('unauthorized employee cannot be punched', async () => {
  const auth = await getAuthAndDatabase()
  auth.user.employeeId = '507f1f77bcf86cd799439099'
  expect((await POST(request('clock-in'))).status).toBe(403)
  expect(saveAttendancePunch).not.toHaveBeenCalled()
  expect(mockAfter).toHaveLength(0)
})

test('duplicate check-in is rejected before side effects', async () => {
  expect((await POST(request('clock-in'))).status).toBe(400)
  expect(saveAttendancePunch).not.toHaveBeenCalled()
  expect(mockAfter).toHaveLength(0)
})

test('failed persistence never acknowledges success or schedules integrations', async () => {
  saveAttendancePunch.mockRejectedValue(new Error('Database unavailable'))
  expect((await POST(request('clock-out'))).status).toBe(500)
  expect(mockAfter).toHaveLength(0)
})

test('address enrichment runs after response and only updates the captured location', async () => {
  const response = await POST(request('clock-out'))
  const saved = await response.json()
  reverseGeocode.mockResolvedValue({ success: true, address: 'Resolved address', details: { city: 'Test' } })
  await mockAfter[0]()
  expect(database.mutate).toHaveBeenCalledWith('attendances', attendanceId, expect.any(Function))
  expect(record.location.checkOut.address).toBe('Resolved address')
  expect(saveAttendancePunch).toHaveBeenCalledTimes(1)
})

test('cache outage after persistence is not returned as a failed punch', async () => {
  clearCachePattern.mockRejectedValue(new Error('Redis unavailable'))
  expect((await POST(request('clock-out'))).status).toBe(200)
})

test('failed background geocoding cannot undo the saved checkout', async () => {
  const response = await POST(request('clock-out'))
  reverseGeocode.mockRejectedValue(new Error('Provider unavailable'))
  await expect(mockAfter[0]()).resolves.toBeUndefined()
  expect(response.status).toBe(200)
  expect(saveAttendancePunch).toHaveBeenCalledTimes(1)
  expect(database.mutate).not.toHaveBeenCalled()
})
