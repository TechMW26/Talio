import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '../../lib/platform/firestoreStore.server'
import { addEmployeeReview, deleteEmployeeReview, listEmployeeReviews } from '../../lib/employeeReviews.server'
import { listOnboardingPasswords, revealOnboardingPassword } from '../../lib/employeePasswords.server'
import { encryptPassword } from '../../lib/passwordEncryption'

jest.setTimeout(45000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
const employeeId = '111111111111111111111111', reviewerId = '222222222222222222222222', userId = '333333333333333333333333', adminId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
emulator('native employee reviews and credential auditing', () => {
  let firestore, database, admin
  beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    process.env.ONBOARDING_PASSWORD_KEY = 'local-only-credential-test-key'
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
    database = createFirestoreDatabase({ firestore, dataset: `test-employee-utils-${Date.now()}`, databaseName: 'talio_company_utilities' })
    admin = { _id: adminId, role: 'admin', employeeId: reviewerId, isActive: true, email: 'admin@example.test' }
    await database.create('users', admin)
    await database.create('employees', { _id: employeeId, firstName: 'Employee', lastName: 'One', reviews: [] })
    await database.create('employees', { _id: reviewerId, firstName: 'Reviewer', lastName: 'One' })
    await database.create('users', { _id: userId, email: 'employee@example.test', employeeId, isActive: true, forcePasswordChange: true, encryptedOnboardingPassword: encryptPassword('test-only-initial-password'), password: 'not-returned-hash' })
  })
  afterAll(async () => { await firestore?.terminate(); delete process.env.ONBOARDING_PASSWORD_KEY })
  test('concurrent reviews both survive and return public reviewer fields', async () => {
    const records = await Promise.all(['First review', 'Second review'].map(content => addEmployeeReview(database, admin, employeeId, { type: 'review', content, category: 'skills', rating: 4 })))
    expect(records[0].reviewedBy.firstName).toBe('Reviewer')
    expect(await listEmployeeReviews(database, admin, employeeId)).toHaveLength(2)
    await deleteEmployeeReview(database, admin, employeeId, records[0]._id)
    expect(await listEmployeeReviews(database, admin, employeeId)).toHaveLength(1)
  })
  test('review access and validation remain enforced', async () => {
    await expect(listEmployeeReviews(database, { role: 'employee', employeeId: reviewerId }, employeeId)).rejects.toMatchObject({ status: 403 })
    await expect(addEmployeeReview(database, admin, employeeId, { type: 'review', content: 'Test', rating: 8 })).rejects.toMatchObject({ status: 400 })
    await expect(deleteEmployeeReview(database, { role: 'manager' }, employeeId, 'bbbbbbbbbbbbbbbbbbbbbbbb')).rejects.toMatchObject({ status: 403 })
  })
  test('password inventory masks values and excludes hashes and ciphertext', async () => {
    const result = await listOnboardingPasswords(database, admin, new URLSearchParams('search=employee'))
    expect(result.data).toHaveLength(1)
    expect(result.data[0].hasPassword).toBe(true)
    expect(result.data[0].password).not.toBe('test-only-initial-password')
    expect(result.data[0].encryptedOnboardingPassword).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('not-returned-hash')
    expect(await database.count('passwordauditlogs')).toBe(1)
  })
  test('reveal requires current permission and atomically audits without saving plaintext', async () => {
    const result = await revealOnboardingPassword(database, admin, { userId })
    expect(result.password).toBe('test-only-initial-password')
    const logs = (await database.list('passwordauditlogs')).records
    expect(logs.some(log => log.action === 'view_password' && log.targetUser === userId)).toBe(true)
    expect(JSON.stringify(logs)).not.toContain('test-only-initial-password')
    await database.mutate('users', adminId, user => ({ ...user, role: 'employee' }))
    await expect(revealOnboardingPassword(database, admin, { userId })).rejects.toMatchObject({ status: 403 })
    await database.mutate('users', adminId, user => ({ ...user, role: 'admin' }))
  })
  test('completed password change cannot reveal stale encrypted onboarding credentials', async () => {
    await database.mutate('users', userId, user => ({ ...user, forcePasswordChange: false }))
    await expect(revealOnboardingPassword(database, admin, { userId })).rejects.toMatchObject({ status: 410, passwordStatus: 'changed_by_user' })
    const result = await listOnboardingPasswords(database, admin, new URLSearchParams('search=employee'))
    expect(result.data[0]).toMatchObject({ password: null, hasPassword: false, passwordStatus: 'changed_by_user' })
  })
})
