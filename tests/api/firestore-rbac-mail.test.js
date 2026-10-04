jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail })) } }))
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { ROLE_STORE_OPTIONS, createNativeRole, updateNativeRole, assignNativeRole, deleteNativeRole, listNativeRoles } from '@/lib/platform/firestoreRoles.server'
import { getPermissionsForLegacyRole } from '@/lib/systemRoles'
import { sendAndLogOnboardingEmail, retryOnboardingEmail } from '@/lib/mailer'
import { ONBOARDING_STORE_OPTIONS, onboardingEmailView, listOnboardingEmails, queueFailedOnboardingEmails } from '@/lib/onboardingEmails.server'
import { PROJECT_EMAIL_STORE_OPTIONS, queueProjectCreatedEmailNotifications, processProjectEmailNotificationLog } from '@/lib/projectEmailNotifications'
const mockSendMail = jest.fn()
jest.setTimeout(60000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip

emulator('native role and email workflows', () => {
  let firestore, dataset, database
  const databaseName = 'talio_company_rbacmail'
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
    process.env.ONBOARDING_PASSWORD_KEY = 'unit-test-only-encryption-key'
    process.env.EMAIL_HOST = 'mock.invalid'; process.env.EMAIL_USER = 'mock@example.test'; process.env.EMAIL_PASSWORD = 'mock-only'
  })
  beforeEach(() => {
    dataset = `test-rbacmail-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    getFirestoreTenantDatabase.mockImplementation(async (name, options = {}) => createFirestoreDatabase({ firestore, dataset, databaseName: name, ...options }))
    database = createFirestoreDatabase({ firestore, dataset, databaseName, queryFields: { ...ROLE_STORE_OPTIONS.queryFields, ...ONBOARDING_STORE_OPTIONS.queryFields, ...PROJECT_EMAIL_STORE_OPTIONS.queryFields, users: ['roleId', 'isActive', 'email', 'employeeId'] }, constraints: { ...ROLE_STORE_OPTIONS.constraints, ...PROJECT_EMAIL_STORE_OPTIONS.constraints } })
    mockSendMail.mockReset(); mockSendMail.mockResolvedValue({ messageId: 'mock-message-id' })
  })
  afterAll(async () => { await firestore?.terminate(); for (const key of ['ONBOARDING_PASSWORD_KEY', 'EMAIL_HOST', 'EMAIL_USER', 'EMAIL_PASSWORD']) delete process.env[key] })
  test('creates, assigns, updates and tombstones roles without cross-tenant changes', async () => {
    await database.create('companies', { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Fixture' })
    const userId = 'bbbbbbbbbbbbbbbbbbbbbbbb'
    await database.create('users', { _id: userId, isActive: true, role: 'employee' })
    const role = await createNativeRole(database, { _id: userId }, { name: 'support_custom', displayLabel: 'Support', permissions: getPermissionsForLegacyRole('employee') })
    expect(await assignNativeRole(database, role._id, [userId])).toEqual([userId])
    expect((await listNativeRoles(database, true))[0].userCount).toBe(1)
    await updateNativeRole(database, role._id, { description: 'Changed' })
    const deleted = await deleteNativeRole(database, role._id)
    expect(deleted.userIds).toEqual([userId])
    expect((await database.get('users', userId)).roleId).toBeNull()
    expect(await listNativeRoles(database)).toEqual([])
    expect((await database.get('roles', role._id)).deletedAt).toBeInstanceOf(Date)
    await expect(assignNativeRole(database, role._id, [userId])).rejects.toMatchObject({ status: 404 })
  })
  const input = () => ({ database, employeeId: 'aaaaaaaaaaaaaaaaaaaaaaaa', userId: 'bbbbbbbbbbbbbbbbbbbbbbbb', firstName: 'Mail', lastName: 'Fixture', email: 'mail@example.test', password: 'local-test-only-password', employeeCode: 'MAIL-1' })
  test('queue-only onboarding is durable without SMTP and stale cron snapshots cannot resend', async () => {
    const result = await sendAndLogOnboardingEmail({ ...input(), queueOnly: true })
    expect(result.queued).toBe(true)
    expect(mockSendMail).not.toHaveBeenCalled()
    expect((await database.get('onboardingemails', result.emailLogId)).queued).toBe(true)
    expect((await retryOnboardingEmail(result.emailLogId, null, database, { onlyQueued: true })).success).toBe(true)
    expect((await retryOnboardingEmail(result.emailLogId, null, database, { onlyQueued: true })).skipped).toBe(true)
    expect(mockSendMail).toHaveBeenCalledTimes(1)
  })
  test('persists encrypted credentials before provider call and excludes them from history', async () => {
    mockSendMail.mockImplementation(async () => {
      expect(await database.count('onboardingemails')).toBe(1)
      return { messageId: 'mock' }
    })
    const result = await sendAndLogOnboardingEmail(input())
    expect(result.success).toBe(true)
    const record = await database.get('onboardingemails', result.emailLogId)
    expect(record.passwordSent).toBeUndefined()
    expect(record.encryptedPasswordSent).not.toContain('local-test-only-password')
    expect(record.status).toBe('sent')
    const view = await onboardingEmailView(database, record)
    expect(view.passwordSent).toBeUndefined(); expect(view.encryptedPasswordSent).toBeUndefined()
    const history = await listOnboardingEmails(database, new URLSearchParams('search=fixture'))
    expect(history.data).toHaveLength(1)
  })
  test('disabled onboarding does not write or send; rate limits schedule native retries', async () => {
    await database.create('companysettings', { _id: 'settings', notifications: { onboardingEmailsEnabled: false } })
    expect((await sendAndLogOnboardingEmail(input())).skipped).toBe(true)
    expect(mockSendMail).not.toHaveBeenCalled()
    mockSendMail.mockRejectedValue(new Error('451 rate limit'))
    const result = await sendAndLogOnboardingEmail({ ...input(), forceEnabled: true })
    expect(result.rateLimited).toBe(true)
    expect((await database.get('onboardingemails', result.emailLogId)).queued).toBe(true)
    mockSendMail.mockResolvedValue({ messageId: 'retry' })
    expect((await retryOnboardingEmail(result.emailLogId, 'actor', database)).success).toBe(true)
  })
  test('simultaneous retry attempts lease delivery so only one provider call runs', async () => {
    mockSendMail.mockRejectedValue(new Error('mailbox rejected'))
    const result = await sendAndLogOnboardingEmail(input())
    mockSendMail.mockClear()
    let release
    const gate = new Promise(resolve => { release = resolve })
    mockSendMail.mockImplementation(async () => { await gate; return { messageId: 'one' } })
    const first = retryOnboardingEmail(result.emailLogId, 'actor', database)
    while (mockSendMail.mock.calls.length === 0) await new Promise(resolve => setTimeout(resolve, 20))
    const second = await retryOnboardingEmail(result.emailLogId, 'actor', database)
    expect(second.busy).toBe(true)
    release(); expect((await first).success).toBe(true)
    expect(mockSendMail).toHaveBeenCalledTimes(1)
  })
  test('project queues are idempotent and already-sent messages never resend', async () => {
    const employee = 'aaaaaaaaaaaaaaaaaaaaaaaa', project = 'bbbbbbbbbbbbbbbbbbbbbbbb'
    await database.create('employees', { _id: employee, firstName: 'Project', email: 'project@example.test' })
    await database.create('projects', { _id: project, name: 'Fixture', createdBy: employee, projectHead: employee, createdAt: new Date('2026-01-01') })
    await database.create('projectmembers', { _id: 'member', project, user: employee, invitationStatus: 'accepted', role: 'head' })
    expect((await queueProjectCreatedEmailNotifications({ projectId: project, database })).queuedCount).toBe(1)
    expect((await queueProjectCreatedEmailNotifications({ projectId: project, database })).queuedCount).toBe(0)
    const log = (await database.list('projectemailnotificationlogs', { limit: 10 })).records[0]
    expect((await processProjectEmailNotificationLog(log, database)).success).toBe(true)
    expect((await processProjectEmailNotificationLog(log, database)).skipped).toBe(true)
    expect(mockSendMail).toHaveBeenCalledTimes(1)
  })
})
