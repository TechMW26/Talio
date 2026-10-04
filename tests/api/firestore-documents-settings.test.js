import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '../../lib/platform/firestoreStore.server'
import { readOrUpdateCompanySettings } from '../../lib/companySettings.server'
import { sanitizeCompanySettingsForClient } from '../../lib/companySettingsUtils'
import { decryptSecret } from '../../lib/secretEncryption'
import { DOCUMENT_STORE_OPTIONS, listDocuments, createDocument, updateDocument } from '../../lib/documents.server'
import { submitOnboarding } from '../../lib/hrms/onboardingFirestore.server'
import { getNativeOnboardingKycEvidence } from '../../lib/hrms/onboardingKyc.server'

jest.setTimeout(45000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
const employeeId = '111111111111111111111111'
const otherId = '222222222222222222222222'
const user = { _id: 'user', role: 'employee', employeeId }
const hr = { _id: 'hr', role: 'hr' }

emulator('native company settings and document workflows', () => {
  let firestore, database, second
  beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = 'local-test-only-encryption-key'
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
    const dataset = `test-documents-${Date.now()}`
    database = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_company_docs', ...DOCUMENT_STORE_OPTIONS })
    second = createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_company_other', ...DOCUMENT_STORE_OPTIONS })
    await database.create('employees', { _id: employeeId, firstName: 'Employee', phone: '1111111111', dateOfJoining: new Date('2026-01-01'), employeeCode: 'E1', userId: user._id })
    await database.create('employees', { _id: otherId, firstName: 'Other', employeeCode: 'E2' })
    await database.create('users', { ...user, profileCompletion: { aadhaarFront: { url: '/api/files/tenant-private-proof' } } })
    await database.create('users', { ...hr })
  })
  afterAll(async () => { await firestore?.terminate(); delete process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY })

  test('settings creation is singular and partial concurrent edits do not lose fields', async () => {
    await Promise.all([readOrUpdateCompanySettings(database), readOrUpdateCompanySettings(database)])
    expect(await database.count('companysettings')).toBe(1)
    await Promise.all([
      readOrUpdateCompanySettings(database, { notifications: { emailEvents: { attendance: false } } }),
      readOrUpdateCompanySettings(database, { notifications: { emailEvents: { leave: true } } }),
    ])
    const settings = await readOrUpdateCompanySettings(database)
    expect(settings.notifications.emailEvents).toEqual({ login: true, attendance: false, leave: true })
    expect(await second.count('companysettings')).toBe(0)
  })
  test('settings secrets stay encrypted and client sanitization does not mutate the stored result', async () => {
    const result = await readOrUpdateCompanySettings(database, { integrations: { linkedin: { accessToken: 'test-only-token', isActive: true } } })
    const encrypted = result.integrations.linkedin.accessToken
    expect(encrypted).not.toBe('test-only-token')
    expect(decryptSecret(encrypted)).toBe('test-only-token')
    expect(sanitizeCompanySettingsForClient(result).integrations.linkedin.accessToken).toBeUndefined()
    expect(result.integrations.linkedin.accessToken).toBe(encrypted)
    await expect(readOrUpdateCompanySettings(database, { _id: 'attack' })).rejects.toThrow('Invalid company settings field')
    await expect(readOrUpdateCompanySettings(database, { leave: { halfDayPolicy: { defaultAnnualLimit: -1 } } })).rejects.toThrow('non-negative')
  })
  test('document listing preserves self/KYC scope and excludes inline media', async () => {
    await database.create('documents', { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Own', employee: employeeId, generatedPdf: Buffer.from('not-a-real-pdf') })
    await database.create('documents', { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Other', employee: otherId })
    const own = await listDocuments(database, user)
    expect(own.map(doc => doc.name).sort()).toEqual(['Aadhaar Card (Front)', 'Own'])
    expect(own.every(doc => doc.generatedPdf === undefined)).toBe(true)
    await expect(listDocuments(database, user, { employeeId: otherId })).rejects.toMatchObject({ status: 403 })
    expect(await listDocuments(database, hr)).toHaveLength(3)
    expect(await listDocuments(second, hr)).toHaveLength(0)
    expect(await getNativeOnboardingKycEvidence(database, employeeId)).toEqual({ aadhaar: [{ fileName: 'Aadhaar Card (Front)', fileUrl: '/api/files/tenant-private-proof' }] })
  })
  test('creation ignores client approval/ownership escalation and review is authorized', async () => {
    const created = await createDocument(database, user, { fileName: 'Uploaded', fileType: 'application/pdf', fileUrl: '/api/files/proof', employee: otherId, status: 'approved' })
    expect(created.status).toBe('pending')
    expect(created.employee._id).toBe(employeeId)
    await expect(updateDocument(database, user, created._id, { status: 'approved' })).rejects.toMatchObject({ status: 403 })
    expect((await updateDocument(database, hr, created._id, { status: 'approved' })).status).toBe('approved')
    await expect(updateDocument(database, user, 'bbbbbbbbbbbbbbbbbbbbbbbb', {}, { remove: true })).rejects.toMatchObject({ status: 403 })
    await updateDocument(database, user, created._id, {}, { remove: true })
    expect(await database.get('documents', created._id)).toBeNull()
  })
  test('onboarding submission commits checklist and file references together and rejects stale updates', async () => {
    const employee = await database.get('employees', employeeId)
    const args = {
      employee, userId: user._id, itemKey: 'profile',
      verification: { details: { phone: '1111111111', emergencyContactName: 'Contact', emergencyContactRelationship: 'Parent', emergencyContactPhone: '2222222222' }, documents: [] },
      linkedEvidence: {}, validateFiles: async value => value,
    }
    await submitOnboarding(database, args)
    expect((await database.get('employees', employeeId)).lifecycle.onboarding.checklist.find(item => item.key === 'profile').submission.status).toBe('pending')
    await expect(submitOnboarding(database, args)).rejects.toMatchObject({ status: 409 })
    const current = await database.get('employees', employeeId)
    await expect(submitOnboarding(database, { ...args, employee: current, userId: hr._id })).rejects.toThrow('no longer linked')
  })
})
