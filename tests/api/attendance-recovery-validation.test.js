import { POST } from '@/app/api/cron/auto-checkout/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { getAttendanceStore, getAttendanceSettings } from '@/lib/platform/firestoreAttendance.server'
import { recoverAttendanceDay } from '@/lib/attendanceNotificationScheduler'
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/cronAuth', () => ({ getCronAuthErrorResponse: () => new Response(null, { status: 401 }) }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreSystemDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreAttendance.server', () => ({ getAttendanceStore: jest.fn(), getAttendanceSettings: jest.fn(), attendanceError: message => new Error(message) }))
jest.mock('@/lib/attendanceNotificationScheduler', () => ({ recoverAttendanceDay: jest.fn() }))
beforeEach(() => {
  jest.clearAllMocks()
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { role: 'admin' }, tenant: { databaseName: 'tenant-a', slug: 'a' } })
  getAttendanceStore.mockResolvedValue({})
  getAttendanceSettings.mockResolvedValue({ company: { timezone: 'Asia/Kolkata' }, settings: {} })
  recoverAttendanceDay.mockResolvedValue({ processed: 0, rectified: 0, alreadyCorrect: 0, notified: 0, errors: [], dryRun: true })
})
const request = date => new Request('https://talio.test/api/cron/auto-checkout', { method: 'POST', body: JSON.stringify({ date, dryRun: true }) })
test('valid past dates reach recovery with dry-run preserved', async () => {
  expect((await (await POST(request('2024-02-29'))).json()).success).toBe(true)
  expect(recoverAttendanceDay).toHaveBeenCalledWith({}, '2024-02-29', expect.objectContaining({ dryRun: true }))
})
test.each(['2024-02-30', '2023-02-29', 'not-a-date', '2999-01-01'])('invalid date %s cannot trigger recovery', async date => {
  expect((await (await POST(request(date))).json()).success).toBe(false)
  expect(recoverAttendanceDay).not.toHaveBeenCalled()
})
