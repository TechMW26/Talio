jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.setTimeout(60000)
import { Firestore } from '@google-cloud/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getNativePasswordRepository } from '@/lib/platform/firestorePassword.server'
import { compareStoredPassword } from '@/lib/passwordAuth'

const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
emulator('native password lifecycle emulator integration', () => {
  let firestore, database, repository
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  beforeEach(async () => {
    const dataset = `password-fixture-${Date.now()}-${Math.floor(Math.random() * 1000)}`
    getFirestoreTenantDatabase.mockImplementation(async (databaseName, options) => {
      database = createFirestoreDatabase({ firestore, dataset, databaseName, ...options })
      return database
    })
    repository = await getNativePasswordRepository('talio_company_password')
    await database.create('users', { _id: 'fixture-user', email: 'fixture@example.test', password: 'Old-Fixture-Password1', isActive: true, forcePasswordChange: true, encryptedOnboardingPassword: 'fixture-encrypted', customField: 'preserved' })
  })
  afterAll(async () => { await firestore?.terminate() })
  const issue = repository => repository.issue('fixture-user', { ipAddress: 'fixture-ip', userAgent: 'fixture-agent', windowMs: 3600000, maxRequests: 3 })

  test('concurrent requests are transactionally capped and only latest link remains valid', async () => {
    const issued = await Promise.all(Array.from({ length: 5 }, () => issue(repository)))
    expect(issued.filter(Boolean)).toHaveLength(3)
    const validations = await Promise.allSettled(issued.filter(Boolean).map(record => repository.validate(record.token)))
    expect(validations.filter(record => record.status === 'fulfilled')).toHaveLength(1)
    const stored = await database.list('passwordresettokens', { limit: 10 })
    expect(stored.records).toHaveLength(3)
    for (const record of stored.records) expect(issued.some(entry => entry?.token === record.tokenHash)).toBe(false)
  })

  test('reset atomically consumes token, hashes password and revokes every prior auth version', async () => {
    const issued = await issue(repository)
    const resets = await Promise.allSettled([
      repository.reset(issued.token, 'New-Fixture-Password2!', { ipAddress: 'ip', userAgent: 'agent' }),
      repository.reset(issued.token, 'New-Fixture-Password3!', { ipAddress: 'ip', userAgent: 'agent' }),
    ])
    expect(resets.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const user = await database.get('users', 'fixture-user')
    expect(user.authVersion).toBe(1)
    expect(user.forcePasswordChange).toBe(false)
    expect(user.encryptedOnboardingPassword).toBeNull()
    expect(user.customField).toBe('preserved')
    expect(await compareStoredPassword('Old-Fixture-Password1', user.password)).toBe(false)
    await expect(repository.validate(issued.token)).rejects.toMatchObject({ code: 'INVALID_RESET' })
  })

  test('authenticated password change checks current credential transactionally and retains current session version', async () => {
    await expect(repository.change('fixture-user', 'wrong', 'New-Fixture-Password2!')).rejects.toMatchObject({ code: 'INVALID_RESET' })
    const changed = await repository.change('fixture-user', 'Old-Fixture-Password1', 'New-Fixture-Password2!')
    expect(await compareStoredPassword('New-Fixture-Password2!', changed.password)).toBe(true)
    expect(changed.encryptedOnboardingPassword).toBeNull()
    expect(changed.authVersion).toBeUndefined()
  })
})
