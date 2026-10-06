jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreSystemDatabase: jest.fn() }))
jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn() }))
jest.mock('googleapis', () => ({ google: { auth: { OAuth2: jest.fn() } } }))
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { mutateUserPush, upsertPushSubscription, PUSH_REGISTRATION_OPTIONS, validatePushEndpoint } from '@/lib/pushRegistration.server'
import { getMailAccount, listMailAccounts, updateMailAccount, disconnectMailAccount, getAuthenticatedMailClient, MAIL_ACCOUNT_OPTIONS } from '@/lib/mailAccounts.server'
import { deliverCompanyJob, COMPANY_JOB_OPTIONS } from '@/lib/platform/companyJobs.server'
import { sendWebPushToSubscription, sendWebPushToUser } from '@/lib/webPushNotification'
import webpush from 'web-push'
import { google } from 'googleapis'
jest.setTimeout(60000)
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
suite('native push registration, mail ownership and company job leases', () => {
  let firestore, database, system
  const actor = { _id: 'user', isActive: true }, endpoint = 'https://fcm.googleapis.com/fcm/send/example'
  beforeAll(() => { if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required'); firestore = new Firestore({ projectId: 'demo-talio-firestore' }) })
  beforeEach(async () => {
    delete process.env.TALIO_LOCAL_ACCEPTANCE
    const dataset = `test-push-mail-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    database = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_company_push', queryFields: { ...PUSH_REGISTRATION_OPTIONS.queryFields, ...MAIL_ACCOUNT_OPTIONS.queryFields } })
    system = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_superadmin', scope: 'system', ...COMPANY_JOB_OPTIONS })
    await database.create('users', actor)
  })
  afterEach(() => { delete process.env.TALIO_LOCAL_ACCEPTANCE })
  afterAll(async () => { await firestore?.terminate() })
  test('concurrent token registrations retain both devices and duplicate token remains unique', async () => {
    await Promise.all(['token-a', 'token-b'].map(fcmToken => mutateUserPush(database, actor, 'register', { fcmToken, deviceInfo: { platform: 'web' } })))
    await mutateUserPush(database, actor, 'register', { fcmToken: 'token-a' })
    expect((await database.get('users', 'user')).fcmTokens).toHaveLength(2)
    await mutateUserPush(database, actor, 'remove', { fcmToken: 'token-a' })
    expect((await database.get('users', 'user')).fcmTokens.map(row => row.token)).toEqual(['token-b'])
  })
  test('subscription upsert is idempotent and revocation preserves historical record', async () => {
    const input = { subscription: { endpoint, keys: { p256dh: 'public-key', auth: 'auth-key' } } }
    await Promise.all([1, 2].map(() => upsertPushSubscription(database, actor, input)))
    expect(await database.count('pushsubscriptions')).toBe(1)
    await upsertPushSubscription(database, actor, { endpoint }, true)
    expect((await database.list('pushsubscriptions', { limit: 1 })).records[0].isActive).toBe(false)
    expect(() => validatePushEndpoint('http://127.0.0.1/internal')).toThrow()
  })
  test('disabled users cannot register a device with stale authentication', async () => {
    await database.mutate('users', 'user', row => ({ ...row, isActive: false }))
    await expect(mutateUserPush(database, actor, 'register', { fcmToken: 'token' })).rejects.toMatchObject({ status: 403 })
  })
  test('mail access and writes are owned; disconnect prevents stale refresh writes', async () => {
    await database.create('emailaccounts', { _id: 'own', user: 'user', email: 'own@example.test', isConnected: true, accessToken: 'test-only-token' })
    await database.create('emailaccounts', { _id: 'other', user: 'other', email: 'other@example.test', isConnected: true })
    expect(await getMailAccount(database, actor, 'other')).toBeNull()
    expect(await listMailAccounts(database, actor)).toHaveLength(1)
    await expect(updateMailAccount(database, actor, 'other', { unreadCount: 1 })).rejects.toMatchObject({ status: 403 })
    await disconnectMailAccount(database, actor, 'own')
    await expect(updateMailAccount(database, actor, 'own', { accessToken: 'stale' })).rejects.toMatchObject({ status: 403 })
    expect((await database.get('emailaccounts', 'own')).accessToken).toBeNull()
  })
  test('concurrent company reminders send once and only successful provider response records completion', async () => {
    await system.create('tenantcompanies', { _id: 'company', isActive: true, sent: false })
    const send = jest.fn(async () => ({ success: true })), eligible = row => !row.sent, complete = row => ({ ...row, sent: true })
    await Promise.all([1, 2].map(() => deliverCompanyJob(system, 'company', 'reminder', eligible, send, complete)))
    expect(send).toHaveBeenCalledTimes(1); expect((await system.get('tenantcompanies', 'company')).sent).toBe(true)
    await system.mutate('tenantcompanies', 'company', row => ({ ...row, sent: false }))
    await deliverCompanyJob(system, 'company', 'reminder', eligible, async () => ({ success: false }), complete)
    expect((await system.get('tenantcompanies', 'company')).sent).toBe(false)
  })
  test('local acceptance blocks external provider calls and never marks reminder sent', async () => {
    process.env.TALIO_LOCAL_ACCEPTANCE = '1'
    const send = jest.fn()
    await system.create('tenantcompanies', { _id: 'company', isActive: true, sent: false })
    expect(await deliverCompanyJob(system, 'company', 'reminder', () => true, send, row => ({ ...row, sent: true }))).toMatchObject({ skipped: true })
    expect(send).not.toHaveBeenCalled(); expect((await system.get('tenantcompanies', 'company')).sent).toBe(false)
    expect(await sendWebPushToSubscription({ endpoint }, { title: 'test' })).toMatchObject({ skipped: true })
    expect(await sendWebPushToUser('user', { database })).toMatchObject({ skipped: true })
    expect(webpush.sendNotification).not.toHaveBeenCalled()
    await expect(getAuthenticatedMailClient(database, actor, { _id: 'mail' })).rejects.toMatchObject({ code: 'LOCAL_ACCEPTANCE_DELIVERY_DISABLED' })
    expect(google.auth.OAuth2).not.toHaveBeenCalled()
  })
})
