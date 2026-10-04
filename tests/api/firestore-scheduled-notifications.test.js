import { Firestore } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { SCHEDULE_OPTIONS, saveNotificationSchedule, notificationRecipients, stageDueNotification, processNotificationSchedules } from '@/lib/scheduledNotifications.server'
import { nextNotificationSchedule } from '@/lib/notificationSchedule'
import { INBOX_OPTIONS, listInbox, changeInbox } from '@/lib/notificationInbox.server'
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
jest.setTimeout(45000)
test('recurrence uses saved timezone and clamps monthly day at month end', () => {
  const base = { startDate: '2026-01-01', timezone: 'Asia/Kolkata' }
  expect(nextNotificationSchedule({ ...base, frequency: 'daily', dailyTime: '09:00' }, new Date('2026-10-03T03:31:00Z')).toISOString()).toBe('2026-10-04T03:30:00.000Z')
  expect(nextNotificationSchedule({ ...base, frequency: 'monthly', monthlyDay: 31, monthlyTime: '09:00' }, new Date('2026-02-01T00:00:00Z')).toISOString()).toBe('2026-02-28T03:30:00.000Z')
  expect(nextNotificationSchedule({ ...base, frequency: 'custom', customDays: ['saturday'], customTimes: ['09:00', '17:00'] }, new Date('2026-10-03T04:00:00Z')).toISOString()).toBe('2026-10-03T11:30:00.000Z')
  expect(nextNotificationSchedule({ ...base, frequency: 'weekly', weeklyDays: ['monday'], weeklyTime: '09:00', startDate: '2026-10-06T00:00:00Z' }, new Date('2026-10-03T04:00:00Z')).toISOString()).toBe('2026-10-12T03:30:00.000Z')
})
suite('native scheduled notification outbox', () => {
  let firestore, database
  const employee = '111111111111111111111111', outside = '222222222222222222222222', department = '333333333333333333333333'
  const head = { _id: '444444444444444444444444', employeeId: employee, role: 'department_head', isActive: true }
  const user = { _id: '555555555555555555555555', employeeId: outside, role: 'employee', isActive: true }
  const admin = { _id: '666666666666666666666666', employeeId: outside, role: 'admin', isActive: true }
  const now = new Date('2026-10-03T10:00:00Z')
  beforeAll(() => { if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required'); firestore = new Firestore({ projectId: 'demo-talio-firestore' }) })
  afterAll(() => firestore?.terminate())
  beforeEach(async () => {
    database = createFirestoreDatabase({ firestore, dataset: `test-schedules-${randomBytes(8).toString('hex')}`, databaseName: 'talio_company_test', queryFields: { ...SCHEDULE_OPTIONS.queryFields, ...INBOX_OPTIONS.queryFields } })
    for (const actor of [head, user, admin]) await database.create('users', actor)
    await database.create('employees', { _id: employee, department, status: 'active' }); await database.create('employees', { _id: outside, status: 'active' })
    await database.create('departments', { _id: department, head: employee, isActive: true })
  })
  test('department heads cannot broaden the recipient scope or edit other creators', async () => {
    const row = await saveNotificationSchedule(database, head, 'schedulednotifications', { title: 'Notice', message: 'Details', targetType: 'all' }, { immediate: true, now })
    expect(row.targetType).toBe('department'); expect(await notificationRecipients(database, row)).toEqual([head._id])
    await expect(saveNotificationSchedule(database, head, 'schedulednotifications', { title: 'Notice', message: 'Details', targetType: 'specific', targetUsers: [user._id] }, { immediate: true, now })).rejects.toMatchObject({ status: 403 })
    await expect(saveNotificationSchedule(database, user, 'schedulednotifications', {}, { id: row._id, operation: 'delete' })).rejects.toMatchObject({ status: 403 })
  })
  test('department and role recipients survive compound membership batches', async () => {
    const ids = Array.from({ length: 28 }, (_, index) => (1000 + index).toString(16).padStart(24, '0'))
    await Promise.all(ids.map(async (id, index) => {
      await database.create('employees', { _id: id, department, status: 'active' })
      await database.create('users', { _id: id, employeeId: id, isActive: true, role: `test-role-${index}` })
    }))
    expect((await notificationRecipients(database, { targetType: 'department', targetDepartment: department })).sort()).toEqual([...ids, head._id].sort())
    expect((await notificationRecipients(database, { targetType: 'role', targetRoles: ids.map((_, index) => `test-role-${index}`) })).sort()).toEqual(ids.sort())
  })
  test('overlapping schedule processors stage a single durable occurrence', async () => {
    const row = await saveNotificationSchedule(database, admin, 'schedulednotifications', { title: 'Notice', message: 'Details', targetType: 'all' }, { immediate: true, now })
    const results = await Promise.all([stageDueNotification(database, 'schedulednotifications', row._id, now), stageDueNotification(database, 'schedulednotifications', row._id, now)])
    expect(results.filter(Boolean)).toHaveLength(1); expect(await database.count('notificationdeliveries')).toBe(1)
    const enqueue = jest.fn().mockResolvedValue({ queued: true })
    await processNotificationSchedules(database, now, { enqueue, meetings: false }); await processNotificationSchedules(database, now, { enqueue, meetings: false })
    expect(enqueue).toHaveBeenCalledTimes(1); expect(enqueue.mock.calls[0][2].id).toMatch(/^scheduled:/)
  })
  test('queue failure preserves a retryable outbox without resending source occurrence', async () => {
    const row = await saveNotificationSchedule(database, admin, 'schedulednotifications', { title: 'Notice', message: 'Details' }, { immediate: true, now })
    const enqueue = jest.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue({ queued: true })
    expect((await processNotificationSchedules(database, now, { enqueue, meetings: false })).deliveries.failed).toBe(1)
    expect((await processNotificationSchedules(database, now, { enqueue, meetings: false })).deliveries.queued).toBe(1)
    expect(enqueue.mock.calls[0][2].id).toBe(enqueue.mock.calls[1][2].id)
    expect((await database.get('schedulednotifications', row._id)).status).toBe('sent')
  })
  test('recurring occurrence advances once and protects creator and counters from client fields', async () => {
    const row = await saveNotificationSchedule(database, admin, 'recurringnotifications', { title: 'Recurring', message: 'Details', frequency: 'daily', dailyTime: '16:00', createdBy: user._id, totalSent: 999, timezone: 'Asia/Kolkata' }, { now })
    expect(row.totalSent).toBe(0); expect(row.createdBy).toBe(outside)
    const due = new Date('2026-10-03T10:31:00Z')
    await Promise.all([stageDueNotification(database, 'recurringnotifications', row._id, due), stageDueNotification(database, 'recurringnotifications', row._id, due)])
    const current = await database.get('recurringnotifications', row._id)
    expect(current.totalSent).toBe(1); expect(current.nextScheduledAt.toISOString()).toBe('2026-10-04T10:30:00.000Z')
  })
  test('meeting reminder claim persists sent state, no duplicate outbox on next run', async () => {
    await database.create('meetings', { _id: '777777777777777777777777', title: 'Standup', status: 'scheduled', organizer: employee, invitees: [{ employee: outside }], scheduledStart: new Date('2026-10-03T10:10:00Z'), scheduledEnd: new Date('2026-10-03T11:00:00Z'), reminders: [{ type: '15min' }] })
    const enqueue = jest.fn().mockResolvedValue({ queued: true })
    expect((await processNotificationSchedules(database, now, { enqueue })).meetingReminders.processed).toBe(1)
    expect((await processNotificationSchedules(database, now, { enqueue })).meetingReminders.processed).toBe(0)
    expect(enqueue).toHaveBeenCalledTimes(1); expect(await database.count('notificationdeliveries')).toBe(1)
  })
  test('an expired schedule snapshot cannot disable a concurrently extended schedule', async () => {
    const id = '777777777777777777777777'
    const stale = { _id: id, isActive: true, nextScheduledAt: now, endDate: new Date(now.getTime() - 1000), updatedAt: new Date(now.getTime() - 2000) }
    await database.create('recurringnotifications', { ...stale, endDate: new Date(now.getTime() + 86400000), updatedAt: now })
    const staleReader = { ...database, get: async (collection, recordId) => collection === 'recurringnotifications' && recordId === id ? stale : database.get(collection, recordId) }
    expect(await stageDueNotification(staleReader, 'recurringnotifications', id, now)).toBeNull()
    expect((await database.get('recurringnotifications', id)).isActive).toBe(true)
    expect(await database.count('notificationdeliveries')).toBe(0)
  })
  test('inbox pagination and read/delete mutations never affect another user', async () => {
    const one = '777777777777777777777777', two = '888888888888888888888888', foreign = '999999999999999999999999'
    for (const [id, owner] of [[one, user._id], [two, user._id], [foreign, head._id]]) await database.create('notifications', { _id: id, user: owner, read: false, title: 'Test', createdAt: now })
    const first = await listInbox(database, user, new URLSearchParams('limit=1'))
    expect(first.data).toHaveLength(1); expect(first.unreadCount).toBe(2)
    const second = await listInbox(database, user, new URLSearchParams({ limit: '1', page: '2', cursor: first.pagination.nextCursor }))
    expect(second.data).toHaveLength(1); expect(second.data[0]._id).not.toBe(first.data[0]._id)
    expect(await changeInbox(database, user, { ids: [one, foreign] })).toBe(1)
    expect((await database.get('notifications', foreign)).read).toBe(false)
    expect(await changeInbox(database, user, { all: true }, true)).toBe(1)
    expect(await database.get('notifications', one)).toBeNull(); expect(await database.get('notifications', two)).not.toBeNull()
  })
})
