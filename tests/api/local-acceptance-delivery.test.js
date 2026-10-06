jest.mock('firebase-admin', () => ({ __esModule: true, default: { apps: [], initializeApp: jest.fn(), credential: { cert: jest.fn() } } }))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: jest.fn() } }))
jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn(), getFirestoreSystemDatabase: jest.fn() }))
import admin from 'firebase-admin'
import nodemailer from 'nodemailer'
import { sendEmail } from '@/lib/mailer'
import { sendNotificationToDevice, sendNotificationToMultipleDevices, sendNotificationToUser, sendNotificationToUsers } from '@/lib/firebaseNotification'
import { sendUnifiedPush } from '@/lib/unifiedPushService'
beforeEach(() => { process.env.TALIO_LOCAL_ACCEPTANCE = '1'; jest.clearAllMocks() })
afterEach(() => { delete process.env.TALIO_LOCAL_ACCEPTANCE })
test('all FCM entrypoints skip before initializing the provider', async () => {
  const user = { _id: 'user', fcmTokens: [{ token: 'fixture', device: 'web' }] }
  for (const result of await Promise.all([sendNotificationToDevice('fixture', {}), sendNotificationToMultipleDevices(['fixture'], {}), sendNotificationToUser(user, {}), sendNotificationToUsers([user], {})])) expect(result).toMatchObject({ success: false, skipped: true, successCount: 0 })
  expect(admin.initializeApp).not.toHaveBeenCalled()
})
test('SMTP entrypoint refuses before creating a transporter', async () => {
  await expect(sendEmail({ to: 'fixture@example.test', subject: 'Test', text: 'Test' })).rejects.toMatchObject({ code: 'LOCAL_ACCEPTANCE_DELIVERY_DISABLED' })
  expect(nodemailer.createTransport).not.toHaveBeenCalled()
})
test('unified push keeps in-app notification but never reports an external send', async () => {
  const database = { databaseName: 'talio_company_test', get: jest.fn(async () => ({ _id: 'user', isActive: true, fcmTokens: [{ token: 'fixture', device: 'web' }] })), create: jest.fn(async (_, row) => row) }
  expect(await sendUnifiedPush('user', { database, title: 'Test', body: 'Test' })).toMatchObject({ success: false, totalSent: 0 })
  expect(database.create).toHaveBeenCalledWith('notifications', expect.objectContaining({ user: 'user', deliveryStatus: expect.objectContaining({ fcm: { sent: false, sentAt: null } }) }))
  expect(admin.initializeApp).not.toHaveBeenCalled()
})
