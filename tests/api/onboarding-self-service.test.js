import { randomBytes } from 'node:crypto'
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { DOCUMENT_STORE_OPTIONS } from '@/lib/documents.server'
const newId = () => randomBytes(12).toString('hex')
import { getAuthAndDatabase } from '@/lib/auth'
import { getImageInfo } from '@/lib/mediaStorage'
import { GET, POST } from '@/app/api/documents/onboarding/route'
import { buildEmployeeLifecycle, hydrateEmployeeLifecycle, applyLifecycleAction, reconcileOnboardingChecklist } from '@/lib/hrms/employeeLifecycle.server'
import { normalizeOnboardingVerification, getOnboardingVerificationRequirement } from '@/lib/hrms/onboardingVerification'
import { canReadDocumentUpload } from '@/lib/documentAccess.server'

jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/mediaStorage', () => ({ getImageInfo: jest.fn() }))
jest.mock('@/lib/cache', () => ({ clearCachePattern: jest.fn().mockResolvedValue(), buildCachePattern: jest.fn() }))
jest.mock('@/lib/platform/blobStorage.server', () => ({ buildTenantBlobPrefix: ({ ownerId }) => `tenants/test/documents/${ownerId}`, getTenantBlob: jest.fn(), buildAuthenticatedBlobUrl: value => `/api/files/${value}` }))

jest.setTimeout(45000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
emulator('Firestore onboarding self-service', () => {
let firestore, database, auth, employeeId, fileId
const request = body => new Request('https://talio.test/api/documents/onboarding', { method: 'POST', body: JSON.stringify(body) })
const evidence = (key = 'aadhaar') => ({ requirementKey: key, fileName: `${key}.pdf`, fileId, fileUrl: `/api/images/${fileId}`, fileSize: 1024, fileType: 'application/pdf' })
beforeAll(() => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
  firestore = new Firestore({ projectId: 'demo-talio-firestore' })
})
afterAll(async () => { await firestore?.terminate() })
beforeEach(async () => {
  database = createFirestoreDatabase({ firestore, dataset: `test-onboarding-${newId()}`, databaseName: 'talio_company_onboarding', ...DOCUMENT_STORE_OPTIONS })
  employeeId = newId()
  const userId = newId()
  fileId = newId()
  await database.create('employees', { _id: employeeId, firstName: 'Aman', lastName: 'Tiwari', __v: 0, lifecycle: buildEmployeeLifecycle({ dateOfJoining: '2026-10-01' }) })
  await database.create('users', { _id: userId, employeeId })
  auth = { success: true, user: { _id: userId, employeeId, role: 'employee' }, database, companyFeatures: { onboarding: true }, tenant: { databaseName: database.databaseName } }
  getAuthAndDatabase.mockResolvedValue(auth)
  getFirestoreTenantDatabase.mockResolvedValue(database)
  getImageInfo.mockReset().mockResolvedValue({ length: 1024, contentType: 'application/pdf', metadata: { userId, category: 'documents' } })
})

test('partial employee upload is persisted as pending in both checklist and document register', async () => {
  const response = await POST(request({ employeeId: String(newId()), itemKey: 'documents', verification: { details: {}, documents: [evidence()] } }))
  expect(response.status).toBe(200)
  const employee = await database.get('employees', employeeId)
  const item = employee.lifecycle.onboarding.checklist.find(item => item.key === 'documents')
  expect(item.completed).toBe(false)
  expect(item.submission.status).toBe('pending')
  expect(item.submission.verification.documents).toHaveLength(1)
  const document = await (await database.list('documents', { filters: [{ field: 'employee', operator: '==', value: employeeId }], limit: 1 })).records[0]
  expect(document).toMatchObject({ status: 'pending', onboardingItemKey: 'documents', fileId })
  const loaded = await (await GET(new Request('https://talio.test'))).json()
  expect(loaded.data.checklist.find(item => item.key === 'documents').submission.status).toBe('pending')
})

test('existing profile Aadhaar is linked without duplicate uploads and other evidence remains required', async () => {
  await database.mutate('users', auth.user._id, current => ({ ...current, profileCompletion: { aadhaarFront: { url: '/api/images/kyc-front', fileId: 'kyc-front' }, aadhaarBack: { url: '/api/images/kyc-back', fileId: 'kyc-back' } } }))
  const loaded = await (await GET(new Request('https://talio.test'))).json()
  expect(loaded.data.linkedEvidence.aadhaar).toHaveLength(2)
  const response = await POST(request({ itemKey: 'documents', verification: { documents: [] } }))
  expect(response.status).toBe(200)
  const employee = await database.get('employees', employeeId)
  const item = employee.lifecycle.onboarding.checklist.find(item => item.key === 'documents')
  expect(item.completed).toBe(false)
  expect(item.submission.verification.details.aadhaarSource).toBe('Submitted through profile KYC')
  expect(await database.count('documents', [{ field: 'employee', operator: '==', value: employeeId }])).toBe(0)
  const context = { employee, linkedEvidence: loaded.data.linkedEvidence }
  expect(() => normalizeOnboardingVerification('documents', {}, context)).toThrow('PAN card must be uploaded')
  const documents = getOnboardingVerificationRequirement('documents').uploads.filter(upload => upload.required && upload.key !== 'aadhaar').map(upload => evidence(upload.key))
  expect(() => applyLifecycleAction(hydrateEmployeeLifecycle(employee), 'complete_onboarding_item', { itemKey: 'documents', verification: { documents } }, context)).not.toThrow()
})

test('another employee KYC and client-supplied linked evidence cannot satisfy own Aadhaar', async () => {
  await database.create('users', { _id: newId(), ...{ email: 'other-kyc@example.test', employeeId: newId(), profileCompletion: { aadhaarFront: { url: '/api/images/foreign' } } } })
  const loaded = await (await GET(new Request('https://talio.test'))).json()
  expect(loaded.data.linkedEvidence).toEqual({})
  expect((await POST(request({ itemKey: 'documents', verification: { details: { aadhaarSource: 'Forged' }, linkedEvidence: { aadhaar: [{ fileUrl: '/foreign' }] } } }))).status).toBe(400)
})

test('profile phone comes from own account and remains current through submission and HR approval', async () => {
  await database.mutate('employees', employeeId, current => ({ ...current, ...{ phone: '9000000001' } }))
  const loaded = await (await GET(new Request('https://talio.test'))).json()
  expect(loaded.data.profilePhone).toBe('9000000001')
  const details = { phone: 'stale-client-number', emergencyContactName: 'Test Contact', emergencyContactRelationship: 'Sibling', emergencyContactPhone: '9000000003' }
  expect((await POST(request({ itemKey: 'profile', verification: { details } }))).status).toBe(200)
  let employee = await database.get('employees', employeeId)
  const pending = employee.lifecycle.onboarding.checklist.find(item => item.key === 'profile')
  expect(pending.submission.verification.details.phone).toBe('9000000001')
  expect(pending.submission.status).toBe('pending')
  expect(employee.emergencyContact?.name).toBeFalsy()
  await database.mutate('employees', employeeId, current => ({ ...current, ...{ phone: '9000000002' } }))
  employee = await database.get('employees', employeeId)
  const result = normalizeOnboardingVerification('profile', pending.submission.verification, { employee })
  expect(result.employeeUpdates.phone).toBe('9000000002')
  expect(result.employeeUpdates.emergencyContact.name).toBe('Test Contact')
  expect(() => normalizeOnboardingVerification('profile', { details: {} }, { employee })).toThrow('Emergency contact name is required')
})

test('pending uploads never auto-complete and HR still requires all mandatory evidence', async () => {
  await POST(request({ itemKey: 'documents', verification: { documents: [evidence()] } }))
  const employee = await database.get('employees', employeeId)
  const lifecycle = hydrateEmployeeLifecycle(employee)
  expect(reconcileOnboardingChecklist(lifecycle, { documents: { completed: true } }).lifecycle.onboarding.checklist.find(item => item.key === 'documents').completed).toBe(false)
  const verification = lifecycle.onboarding.checklist.find(item => item.key === 'documents').submission.verification
  expect(() => applyLifecycleAction(lifecycle, 'complete_onboarding_item', { itemKey: 'documents', verification }, { actorId: auth.user._id, employee })).toThrow('PAN card must be uploaded')
})

test('HR can request changes; employee resubmission clears feedback and stays pending', async () => {
  await POST(request({ itemKey: 'documents', verification: { documents: [evidence()] } }))
  const employee = await database.get('employees', employeeId)
  const result = applyLifecycleAction(hydrateEmployeeLifecycle(employee), 'request_onboarding_changes', { itemKey: 'documents', reason: 'Upload a readable copy' }, { actorId: auth.user._id, employee })
  await database.mutate('employees', employeeId, current => ({ ...current, ...{ lifecycle: result.lifecycle } }))
  expect((await POST(request({ itemKey: 'documents', verification: { documents: [evidence()] } }))).status).toBe(200)
  const item = (await database.get('employees', employeeId)).lifecycle.onboarding.checklist.find(item => item.key === 'documents')
  expect(item.submission).toMatchObject({ status: 'pending', reviewReason: '' })
})

test('full evidence approval is auditable and cannot be overwritten by employee', async () => {
  const documents = getOnboardingVerificationRequirement('documents').uploads.filter(upload => upload.required).map(upload => evidence(upload.key))
  await POST(request({ itemKey: 'documents', verification: { documents } }))
  const employee = await database.get('employees', employeeId)
  const result = applyLifecycleAction(hydrateEmployeeLifecycle(employee), 'complete_onboarding_item', { itemKey: 'documents', verification: { documents } }, { actorId: auth.user._id, employee })
  const item = result.lifecycle.onboarding.checklist.find(item => item.key === 'documents')
  expect(item).toMatchObject({ completed: true, submission: { status: 'approved' }, verification: { status: 'verified' } })
  await database.mutate('employees', employeeId, current => ({ ...current, ...{ lifecycle: result.lifecycle } }))
  expect((await POST(request({ itemKey: 'documents', verification: { documents } }))).status).toBe(409)
})

test('rejects files owned by another user and forged register metadata', async () => {
  getImageInfo.mockResolvedValue({ length: 1024, contentType: 'application/pdf', metadata: { userId: String(newId()), category: 'documents' } })
  await database.create('documents', { _id: newId(), ...{ employee: employeeId, fileId, name: 'fake.pdf', type: 'application/pdf', url: '/api/images/foreign', status: 'pending' } })
  expect((await POST(request({ itemKey: 'documents', verification: { documents: [evidence()] } }))).status).toBe(400)
  expect((await database.get('employees', employeeId)).__v).toBe(0)
})

test('rejects empty submissions, unavailable features, and unauthenticated access', async () => {
  expect((await POST(request({ itemKey: 'documents', verification: {} }))).status).toBe(400)
  auth.companyFeatures.onboarding = false
  expect((await POST(request({ itemKey: 'documents', verification: { documents: [evidence()] } }))).status).toBe(403)
  auth.success = false
  expect((await GET(new Request('https://talio.test'))).status).toBe(401)
})

test('pending payroll data remains usable for HR then masks account number after verification', () => {
  const details = { bankName: 'Test Bank', accountNumber: '123456789012', ifscCode: 'TEST0001234' }
  const pending = normalizeOnboardingVerification('payroll', { details }, { submission: true })
  expect(pending.verification.details.accountNumber).toBe(details.accountNumber)
  const verified = normalizeOnboardingVerification('payroll', { details: { ...details, statutoryReference: 'PF verified', statutoryConfirmed: true }, documents: [evidence('bank_proof')] }, {})
  expect(verified.employeeUpdates.bankDetails.accountNumber).toBe(details.accountNumber)
  expect(verified.verification.details.accountNumber).toBeUndefined()
})

test('private upload access denies foreign tenants and forged document registrations', async () => {
  expect(await canReadDocumentUpload(auth, { fileId, ownerId: String(auth.user._id) })).toBe(true)
  const other = newId()
  await database.create('documents', { _id: newId(), ...{ employee: employeeId, fileId, name: 'fake.pdf', type: 'application/pdf', url: '/api/images/foreign', status: 'pending' } })
  expect(await canReadDocumentUpload(auth, { fileId, ownerId: String(other) })).toBe(false)
  auth.user.role = 'hr'
  expect(await canReadDocumentUpload(auth, { fileId, ownerId: String(other) })).toBe(false)
  await database.create('users', { _id: newId(), ...{ _id: other, role: 'hr', email: 'reviewer@example.test' } })
  expect(await canReadDocumentUpload(auth, { fileId, ownerId: String(other) })).toBe(true)
  auth.user.role = 'employee'
  expect(await canReadDocumentUpload(auth, { fileId, ownerId: String(other) })).toBe(false)
  const linked = (await database.list('documents', { filters: [{ field: 'fileId', operator: '==', value: fileId }], limit: 1 })).records[0]
  await database.mutate('documents', linked._id, current => ({ ...current, status: 'approved' }))
  expect(await canReadDocumentUpload(auth, { fileId, ownerId: String(other) })).toBe(true)
})

})
