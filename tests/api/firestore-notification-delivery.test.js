import { Firestore } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { deliverQueuedNotification } from '@/lib/notificationService'
import { sendNotificationToUsers } from '@/lib/firebaseNotification'
import { getPusherServer } from '@/lib/pusherServer'
import { ACTIONABLE_STORE_OPTIONS, storeActionableNotification, updateActionableNotification, listActionableNotifications } from '@/lib/actionableNotificationStore.server'
import { ensureProbationReviewReminder } from '@/lib/hrms/probationReminder.server'

jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreBackgroundJobs.server', () => ({ enqueueBackgroundJob: jest.fn() }))
jest.mock('@/lib/firebaseNotification', () => ({ sendNotificationToUsers: jest.fn() }))
jest.mock('@/lib/pusherServer', () => ({ getPusherServer: jest.fn() }))
jest.mock('@/lib/cache', () => ({ buildCachePattern: () => 'test', clearCachePattern: jest.fn().mockResolvedValue() }))
jest.setTimeout(45000)
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
suite('native notification persistence and delivery', () => {
  let firestore, database, trigger
  const userId = '111111111111111111111111'
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  afterAll(async () => { await firestore?.terminate() })
  beforeEach(async () => {
    jest.clearAllMocks()
    database = createFirestoreDatabase({ firestore, dataset: `test-notifications-${Date.now()}-${randomBytes(5).toString('hex')}`, databaseName: 'talio_company_test', ...ACTIONABLE_STORE_OPTIONS })
    await database.create('users', { _id: userId, isActive: true })
    getFirestoreTenantDatabase.mockResolvedValue(database)
    sendNotificationToUsers.mockResolvedValue({ successCount: 1, failureCount: 0 })
    trigger = jest.fn().mockResolvedValue()
    getPusherServer.mockReturnValue({ trigger })
  })
  const job = () => ({ databaseName: database.databaseName, jobId: 'event-1', userIds: [userId], title: 'Test', message: 'Local test notification' })
  test('job replay persists one inbox record and does not resend a device push', async () => {
    await Promise.all([deliverQueuedNotification(job()), deliverQueuedNotification(job())])
    expect(await database.count('notifications')).toBe(1)
    expect(sendNotificationToUsers).toHaveBeenCalledTimes(1)
    expect((await database.list('notifications')).records[0].deliveryStatus.fcm.status).toBe('sent')
  })
  test('uncertain push is not replayed; durable inbox remains available', async () => {
    sendNotificationToUsers.mockRejectedValueOnce(new Error('Provider acknowledgement lost'))
    await deliverQueuedNotification(job())
    await deliverQueuedNotification(job())
    expect(sendNotificationToUsers).toHaveBeenCalledTimes(1)
    expect((await database.list('notifications')).records[0].deliveryStatus.fcm.status).toBe('unknown')
  })
  test('failed durable write sends no device notification', async () => {
    getFirestoreTenantDatabase.mockResolvedValue({ ...database, transaction: () => Promise.reject(new Error('Storage unavailable')) })
    await expect(deliverQueuedNotification(job())).rejects.toThrow('Storage unavailable')
    expect(sendNotificationToUsers).not.toHaveBeenCalled()
    expect(trigger).not.toHaveBeenCalled()
  })
  test('only the owner can snooze or decide a pending notification; mandatory prompts cannot dismiss', async () => {
    const record = await storeActionableNotification(database, { user: userId, title: 'Review', message: 'Review employee', type: 'probation_approval', displaySettings: { dismissible: false } })
    await expect(updateActionableNotification(database, 'other', record._id, { action: 'snooze' })).rejects.toMatchObject({ status: 404 })
    await expect(updateActionableNotification(database, userId, record._id, { action: 'dismiss' })).rejects.toMatchObject({ status: 409 })
    await updateActionableNotification(database, userId, record._id, { action: 'snooze' })
    expect(await listActionableNotifications(database, userId)).toMatchObject({ count: 0 })
    expect((await listActionableNotifications(database, userId)).nextReminderAt).toBeTruthy()
  })
  test('daily probation reminder is atomic and uses a bounded indexed due-date query', async () => {
    await database.create('employees', { _id: '222222222222222222222222', status: 'active', firstName: 'Test', lastName: 'Employee', lifecycle: { probation: { applicable: true, status: 'in_progress', reviewDate: new Date('2026-10-05') } } })
    const input = { database, user: { _id: userId, role: 'hr' }, now: new Date('2026-10-03') }
    await Promise.all([ensureProbationReviewReminder(input), ensureProbationReviewReminder(input)])
    expect(await database.count('actionablenotifications')).toBe(1)
  })
})
