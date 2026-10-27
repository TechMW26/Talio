jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreBackgroundJobs.server', () => ({ enqueueBackgroundJob: jest.fn() }))
jest.mock('@/lib/firebaseNotification', () => ({ sendNotificationToUsers: jest.fn().mockResolvedValue({ successCount: 1 }) }))
jest.mock('@/lib/pusherServer', () => ({ getPusherServer: jest.fn(() => ({ trigger: jest.fn().mockResolvedValue() })) }))

import { workflowStore } from '../helpers/firestoreWorkflowStore'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { enqueueBackgroundJob } from '@/lib/platform/firestoreBackgroundJobs.server'
import { deliverQueuedNotification } from '@/lib/notificationService'
import { sendNotificationToUsers } from '@/lib/firebaseNotification'
import { createMiraReminder } from '@/lib/miraReminder.server'
import { getMiraProactiveFeed, updateMiraProactiveEvent } from '@/lib/miraProactive.server'
import { processNotificationSchedules } from '@/lib/scheduledNotifications.server'

const user = { _id: '111111111111111111111111', employeeId: '222222222222222222222222', isActive: true, role: 'employee', miraPreferences: { proactive: { enabled: false } } }
let database, now, due
beforeEach(() => {
  jest.clearAllMocks()
  now = new Date(); due = new Date(+now + 2000)
  database = { ...workflowStore({ users: [user] }), databaseName: 'talio_company_pipeline_test' }
  getFirestoreTenantDatabase.mockResolvedValue(database)
  enqueueBackgroundJob.mockImplementation(async (_kind, payload, { id }) => deliverQueuedNotification({ ...payload, jobId: id }))
})

test('cron and reconnect converge on one saved reminder, one outbox, one inbox and one device delivery', async () => {
  const fields = { message: 'Review the proposal', scheduledFor: due.toISOString(), timezone: 'Asia/Kolkata' }
  const [one, two] = await Promise.all([createMiraReminder(database, user, fields, 'voice-turn:one', now), createMiraReminder(database, user, fields, 'voice-turn:one', now)])
  expect(one._id).toBe(two._id)
  await Promise.all([
    processNotificationSchedules(database, due, { meetings: false }),
    getMiraProactiveFeed(database, user, { now: due, includeMail: false }),
  ])
  const feed = await getMiraProactiveFeed(database, user, { now: due, includeMail: false })
  expect(await database.count('schedulednotifications')).toBe(1)
  expect(await database.count('notificationdeliveries')).toBe(1)
  expect(await database.count('notifications')).toBe(1)
  expect(enqueueBackgroundJob).toHaveBeenCalledTimes(1)
  expect(sendNotificationToUsers).toHaveBeenCalledTimes(1)
  expect(feed.events).toHaveLength(1)
  expect(feed.events[0]).toMatchObject({ type: 'reminder', summary: 'Review the proposal' })
  const [, payload, options] = enqueueBackgroundJob.mock.calls[0]
  await deliverQueuedNotification({ ...payload, jobId: options.id })
  expect(await database.count('notifications')).toBe(1)
  expect(sendNotificationToUsers).toHaveBeenCalledTimes(1)
  await updateMiraProactiveEvent(database, user, { id: feed.events[0].id, action: 'dismiss' }, due)
  expect((await getMiraProactiveFeed(database, user, { now: due, includeMail: false })).events).toHaveLength(0)
})

test('failed queue submission survives reconnect and delivery keeps the same job identity', async () => {
  await createMiraReminder(database, user, { message: 'Check in', scheduledFor: due.toISOString(), timezone: 'Asia/Kolkata' }, 'voice-turn:two', now)
  enqueueBackgroundJob.mockRejectedValueOnce(new Error('Queue temporarily unavailable'))
  const first = await getMiraProactiveFeed(database, user, { now: due, includeMail: false })
  expect(first.limitations.join(' ')).toContain('Reminder delivery recovery is temporarily unavailable')
  expect(await database.count('notifications')).toBe(0)
  const second = await getMiraProactiveFeed(database, user, { now: due, includeMail: false })
  expect(enqueueBackgroundJob.mock.calls[0][2].id).toBe(enqueueBackgroundJob.mock.calls[1][2].id)
  expect(second.events).toHaveLength(1)
  expect(await database.count('notifications')).toBe(1)
  expect(sendNotificationToUsers).toHaveBeenCalledTimes(1)
})
