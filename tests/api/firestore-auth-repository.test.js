jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/firebaseNotification', () => ({ sendNotificationToUser: jest.fn(async () => ({ success: true })) }))
import { Firestore } from '@google-cloud/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getNativeAuthRepository, parseSessionUserAgent } from '@/lib/platform/firestoreAuth.server'
import { compareStoredPassword, isBcryptHash } from '@/lib/passwordAuth'

jest.setTimeout(60000)

test('session device parsing retains the login response contract', () => {
  expect(parseSessionUserAgent('Chrome Android mobile')).toMatchObject({ browser: 'Chrome', isMobile: true, device: 'mobile', os: 'Android' })
  expect(parseSessionUserAgent('Talio Desktop Electron/34.0 Mac OS X 14_1')).toMatchObject({ browser: 'Talio Desktop', browserVersion: '34.0', deviceType: 'Desktop App', device: 'desktop', os: 'macOS', osVersion: '14.1' })
  expect(parseSessionUserAgent('Linux; Android 15 Talio-Android')).toMatchObject({ deviceType: 'Android App', os: 'Android', osVersion: '15' })
})

const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
emulator('native auth repository emulator integration', () => {
  let firestore, repository, database, other
  beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
    const dataset = `auth-fixture-${Date.now()}`
    getFirestoreTenantDatabase.mockImplementation(async (databaseName, options) => createFirestoreDatabase({ firestore, dataset, databaseName, ...options }))
    repository = await getNativeAuthRepository('talio_company_auth')
    database = repository.database
    other = (await getNativeAuthRepository('talio_company_other')).database
  })
  afterAll(async () => { await firestore?.terminate() })

  test('atomic failed attempts cannot lose increments; success cannot bypass active lockout', async () => {
    await database.create('users', { _id: 'lock-user', email: 'lock@example.test', password: 'fixture-secret', isActive: true })
    await Promise.all(Array.from({ length: 5 }, () => repository.recordFailedLogin('lock-user', 5, 60000)))
    const user = await database.get('users', 'lock-user')
    expect(user.loginAttempts).toBe(5)
    expect(user.lockUntil.getTime()).toBeGreaterThan(Date.now())
    await expect(repository.completeLogin('lock-user', 'fixture-secret')).rejects.toThrow('locked')
  })

  test('upgrades imported plaintext only after successful verification without dropping user data', async () => {
    await database.create('users', { _id: 'upgrade-user', email: 'upgrade@example.test', password: 'fixture-secret', isActive: true, loginAttempts: 2, profileCompletion: { completedFields: { personalInfo: true } }, custom: 'preserved' })
    await expect(repository.completeLogin('upgrade-user', 'wrong')).rejects.toThrow('Credentials changed')
    const user = await repository.completeLogin('upgrade-user', 'fixture-secret')
    expect(isBcryptHash(user.password)).toBe(true)
    expect(await compareStoredPassword('fixture-secret', user.password)).toBe(true)
    expect(user.custom).toBe('preserved')
    expect(user.loginAttempts).toBe(0)
    expect(user.profileCompletion.completedFields.personalInfo).toBe(true)
    expect(user.profileCompletion.profileCompletionDeadline).toBeInstanceOf(Date)
    expect(await other.get('users', 'upgrade-user')).toBeNull()
  })

  test('joins employee records explicitly within tenant and projects reporting manager fields', async () => {
    await database.create('departments', { _id: 'department', name: 'Operations' })
    await database.create('designations', { _id: 'designation', title: 'Engineer' })
    await database.create('employees', { _id: 'manager', firstName: 'Manager', email: 'manager@example.test', privateField: 'must not leak' })
    await database.create('employees', { _id: 'employee', department: 'department', designation: 'designation', reportingManager: 'manager' })
    const employee = await repository.getEmployee('employee')
    expect(employee.department.name).toBe('Operations')
    expect(employee.reportingManager.privateField).toBeUndefined()
    expect(employee.reportingManager._id).toBe('manager')
  })

  test('sessions persist defaults, remain tenant scoped, and revoke by token ID', async () => {
    const session = await repository.createSession({ user: 'upgrade-user', tokenId: 'fixture-token', expiresAt: new Date(Date.now() + 60000) })
    expect(session.isActive).toBe(true)
    expect(session.lastActivityAt).toBeInstanceOf(Date)
    await expect(repository.createSession({ user: 'upgrade-user', tokenId: 'bad-expiry', expiresAt: 'invalid' })).rejects.toThrow('future expiry')
    expect((await repository.findSession('fixture-token'))._id).toBe(session._id)
    expect(await other.get('usersessions', session._id)).toBeNull()
    await repository.revokeSession('fixture-token')
    expect((await repository.findSession('fixture-token')).isActive).toBe(false)
  })

  test('session refresh rechecks credentials and session expiry atomically', async () => {
    await database.create('users', { _id: 'refresh-user', email: 'refresh@example.test', isActive: true, authVersion: 1 })
    const session = await repository.createSession({ user: 'refresh-user', tokenId: 'refresh-token', expiresAt: new Date(Date.now() + 60000) })
    const payload = { userId: 'refresh-user', tokenId: 'refresh-token', authVersion: 1 }
    const expiry = new Date(Date.now() + 86400000)
    expect((await repository.refreshSession(payload, expiry))._id).toBe('refresh-user')
    expect((await database.get('usersessions', session._id)).expiresAt).toEqual(expiry)
    await database.mutate('users', 'refresh-user', current => ({ ...current, authVersion: 2 }))
    await expect(repository.refreshSession(payload, expiry)).rejects.toMatchObject({ status: 401 })
    await database.mutate('usersessions', session._id, current => ({ ...current, expiresAt: 'invalid' }))
    await expect(repository.refreshSession({ ...payload, authVersion: 2 }, expiry)).rejects.toMatchObject({ status: 401 })
  })
})
