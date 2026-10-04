import { randomBytes } from 'node:crypto'
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { ATTENDANCE_DATABASE_OPTIONS, attendanceKey } from '@/lib/platform/firestoreAttendance.server'
import { getDayName, isWorkingDay, processAbsenceDate } from '@/lib/services/attendanceAbsenceService.server'
import { prepareLeaveAttendanceTransition } from '@/lib/platform/firestoreLeaveAttendance.server'
import { ingestMachinePunches } from '@/lib/attendanceMachines/ingestion.server'
import { processAutoCheckouts, processPastDayIncompleteAttendance, sendOvertimeCheckNotifications } from '@/lib/attendanceNotificationScheduler'
import { getStartOfDayInTimezone } from '@/lib/timezone'
import { enqueueBackgroundJob } from '@/lib/platform/firestoreBackgroundJobs.server'
import { syncHolidayAttendance } from '@/lib/platform/firestoreHolidayAttendance.server'
jest.mock('@/lib/pushNotification', () => ({ sendPushToUser: jest.fn() }))
jest.mock('@/lib/platform/firestoreBackgroundJobs.server', () => ({ enqueueBackgroundJob: jest.fn(async () => ({ queued: true })) }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn(), getFirestoreSystemDatabase: jest.fn() }))
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
jest.setTimeout(30000)
test('working day calculation is timezone-aware near UTC boundary', () => {
  expect(getDayName(new Date('2026-08-30T20:00:00Z'))).toBe('monday')
  expect(isWorkingDay(new Date('2026-08-30T20:00:00Z'), ['monday'])).toBe(true)
})
emulator('native attendance transactions', () => {
  let firestore, database
  const day = new Date('2026-08-31T06:00:00Z')
  const dayStart = getStartOfDayInTimezone(day, 'Asia/Kolkata')
  const settings = { timezone: 'Asia/Kolkata', checkInTime: '09:00', checkOutTime: '18:00', fullDayHours: 8, halfDayHours: 4, breakTimings: [] }
  const machine = { _id: 'machine', name: 'Gate', status: 'active', scope: 'organisation', providerKey: 'custom', serialNumber: 'test', timezone: 'Asia/Kolkata', webhookTokenHash: 'hash', punchDirectionMode: 'first_last' }
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  afterAll(() => firestore.terminate())
  beforeEach(async () => {
    database = createFirestoreDatabase({ firestore, dataset: 'test-attendance-' + randomBytes(8).toString('hex'), databaseName: 'talio_company_attendance_test', ...ATTENDANCE_DATABASE_OPTIONS })
    await database.create('companysettings', { _id: 'settings', ...settings })
    await database.create('employees', { _id: 'employee', employeeCode: 'E1', userId: 'user', status: 'active' })
    await database.create('users', { _id: 'user', employeeId: 'employee' })
    await database.create('attendancemachines', machine)
    enqueueBackgroundJob.mockClear()
  })
  test('absence dry run and weekends do not create attendance', async () => {
    expect(await processAbsenceDate({ database, date: day, dryRun: true })).toMatchObject({ marked: 1 })
    expect(await database.count('attendances')).toBe(0)
    expect(await processAbsenceDate({ database, date: new Date('2026-08-30T06:00:00Z') })).toMatchObject({ skipped: true, skipReason: 'weekend' })
  })
  test('concurrent absence workers create exactly one record', async () => {
    const results = await Promise.all([processAbsenceDate({ database, date: day }), processAbsenceDate({ database, date: day })])
    expect(results.reduce((n, r) => n + r.marked, 0)).toBe(1)
    expect(await database.count('attendances')).toBe(1)
  })
  test('imported attendance and approved leave are never overwritten by absence', async () => {
    await database.create('attendances', { _id: 'imported', employee: 'employee', date: dayStart, status: 'present' })
    expect(await processAbsenceDate({ database, date: day })).toMatchObject({ marked: 0, hadAttendance: 1 })
    await database.delete('attendances', 'imported')
    await database.create('leaves', { _id: 'leave', employee: 'employee', status: 'approved', startDate: dayStart, endDate: dayStart })
    expect(await processAbsenceDate({ database, date: day })).toMatchObject({ marked: 0, onLeave: 1 })
  })
  test('approval and cancellation reconcile only system absence without losing record history', async () => {
    await processAbsenceDate({ database, date: day })
    const leave = { _id: 'leave', employee: 'employee', status: 'pending', startDate: new Date('2026-08-31T00:00:00Z'), endDate: new Date('2026-08-31T00:00:00Z') }
    await database.create('leaves', leave)
    const employee = await database.get('employees', 'employee')
    await database.transaction(async tx => {
      const write = await prepareLeaveAttendanceTransition(tx, employee, leave, 'approved')
      await write()
      await tx.replace('leaves', { ...leave, status: 'approved' })
    })
    expect((await database.get('attendances', attendanceKey('employee', dayStart))).status).toBe('on-leave')
    await database.transaction(async tx => {
      const write = await prepareLeaveAttendanceTransition(tx, employee, { ...leave, status: 'approved' }, 'cancelled')
      await write()
      await tx.delete('leaves', 'leave')
    })
    expect((await database.get('attendances', attendanceKey('employee', dayStart))).status).toBe('absent')
  })
  test('duplicate concurrent device punches update the day once and retain dedup evidence', async () => {
    const payload = { employeeCode: 'E1', punchedAt: '2026-08-31T03:30:00Z', direction: 'in', eventId: 'punch-one' }
    const results = await Promise.all([ingestMachinePunches({ database, machine, payload }), ingestMachinePunches({ database, machine, payload })])
    expect(results.reduce((sum, r) => sum + r.processed, 0)).toBe(1)
    expect(await database.count('attendances')).toBe(1)
    expect(await database.count('attendancemachinepunches')).toBe(1)
    await ingestMachinePunches({ database, machine, payload: { ...payload, eventId: 'out', direction: 'out', punchedAt: '2026-08-31T12:30:00Z' } })
    expect((await database.get('attendances', attendanceKey('employee', dayStart))).workHours).toBe(9)
  })
  test('disabled machine cannot mutate attendance even with a stale authorized request', async () => {
    await database.mutate('attendancemachines', 'machine', m => ({ ...m, status: 'disabled' }))
    expect(await ingestMachinePunches({ database, machine, payload: { employeeCode: 'E1', punchedAt: '2026-08-31T03:30:00Z' } })).toMatchObject({ rejected: 1, processed: 0 })
    expect(await database.count('attendances')).toBe(0)
  })
  test('holiday sync respects location, preserves corrections, and is concurrent-idempotent', async () => {
    await database.mutate('employees', 'employee', e => ({ ...e, workLocation: 'Bhopal' }))
    await database.create('employees', { _id: 'other', userId: 'other-user', status: 'active', workLocation: 'Delhi' })
    await database.create('holidays', { _id: 'holiday', name: 'Local holiday', date: new Date('2026-08-31T00:00:00Z'), isActive: true, applicableTo: 'specific-locations', locations: ['Bhopal'] })
    expect(await syncHolidayAttendance(database, { year: 2026, dryRun: true })).toMatchObject({ created: 1 })
    expect(await database.count('attendances')).toBe(0)
    const results = await Promise.all([syncHolidayAttendance(database, { year: 2026 }), syncHolidayAttendance(database, { year: 2026 })])
    expect(results.reduce((n, r) => n + r.created, 0)).toBe(1)
    expect(await processAbsenceDate({ database, date: day })).toMatchObject({ marked: 1 })
    expect((await database.get('attendances', attendanceKey('other', dayStart))).status).toBe('absent')
    await database.mutate('attendances', attendanceKey('employee', dayStart), a => ({ ...a, status: 'absent', source: 'correction', isManualEntry: true }))
    expect(await syncHolidayAttendance(database, { year: 2026 })).toMatchObject({ updated: 0 })
    expect((await database.get('attendances', attendanceKey('employee', dayStart))).status).toBe('absent')
  })
  test('overtime prompts deduplicate and confirmed overtime prevents same-day automatic checkout', async () => {
    const id = attendanceKey('employee', dayStart)
    await database.create('attendances', { _id: id, employee: 'employee', date: dayStart, checkIn: new Date('2026-08-31T03:30:00Z'), status: 'in-progress' })
    await Promise.all([sendOvertimeCheckNotifications(database, settings, {}, new Date('2026-08-31T13:00:00Z')), sendOvertimeCheckNotifications(database, settings, {}, new Date('2026-08-31T13:00:00Z'))])
    expect(await database.count('overtimerequests')).toBe(1)
    const calls = enqueueBackgroundJob.mock.calls
    expect(calls[0][2].id).toBe(calls[1][2].id)
    const request = (await database.list('overtimerequests')).records[0]
    await database.mutate('overtimerequests', request._id, r => ({ ...r, status: 'overtime-confirmed' }))
    expect(await processAutoCheckouts(database, settings, {}, new Date('2026-08-31T15:00:00Z'))).toMatchObject({ processed: 0 })
    expect(await processPastDayIncompleteAttendance(database, settings, {}, new Date('2026-09-01T06:00:00Z'))).toMatchObject({ processed: 1 })
    expect((await database.get('attendances', id)).checkOut.toISOString()).toBe('2026-08-31T12:30:00.000Z')
  })
})
