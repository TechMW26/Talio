import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { getTenantConnection } from '@/lib/tenantDb'
import { getTenantModels } from '@/lib/tenantModels'
import { getAuthAndModels } from '@/lib/auth'
import { getImageInfo } from '@/lib/gridfs'
import { GET, POST } from '@/app/api/documents/onboarding/route'
import { buildEmployeeLifecycle, hydrateEmployeeLifecycle, applyLifecycleAction, reconcileOnboardingChecklist } from '@/lib/hrms/employeeLifecycle.server'
import { normalizeOnboardingVerification, getOnboardingVerificationRequirement } from '@/lib/hrms/onboardingVerification'
import { canReadDocumentUpload } from '@/lib/documentAccess.server'

jest.mock('@/lib/tenantDb', () => ({ getTenantConnection: jest.fn() }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/gridfs', () => ({ getImageInfo: jest.fn() }))
jest.mock('@/lib/cache', () => ({ clearCachePattern: jest.fn().mockResolvedValue(), buildCachePattern: jest.fn() }))
jest.mock('@/lib/platform/blobStorage.server', () => ({ buildTenantBlobPrefix: ({ ownerId }) => `tenants/test/documents/${ownerId}`, getTenantBlob: jest.fn(), buildAuthenticatedBlobUrl: value => `/api/files/${value}` }))

let server, connection, models, auth, employeeId, fileId
const request = body => new Request('https://talio.test/api/documents/onboarding', { method: 'POST', body: JSON.stringify(body) })
const evidence = (key = 'aadhaar') => ({ requirementKey: key, fileName: `${key}.pdf`, fileId, fileUrl: `/api/images/${fileId}`, fileSize: 1024, fileType: 'application/pdf' })
beforeAll(async () => {
  server = await MongoMemoryServer.create()
  connection = await mongoose.createConnection(server.getUri()).asPromise()
  getTenantConnection.mockResolvedValue(connection)
  models = await getTenantModels('onboarding-test', ['Employee', 'User', 'Document'])
}, 120000)
afterAll(async () => { await connection?.close(); await server?.stop() })
beforeEach(async () => {
  await Promise.all(Object.values(models).map(model => model.deleteMany({})))
  employeeId = new mongoose.Types.ObjectId()
  const userId = new mongoose.Types.ObjectId()
  fileId = String(new mongoose.Types.ObjectId())
  await models.Employee.collection.insertOne({ _id: employeeId, firstName: 'Aman', lastName: 'Tiwari', __v: 0, lifecycle: buildEmployeeLifecycle({ dateOfJoining: '2026-10-01' }) })
  await models.User.collection.insertOne({ _id: userId, employeeId })
  auth = { success: true, user: { _id: userId, employeeId, role: 'employee' }, models, companyFeatures: { onboarding: true }, tenant: { databaseName: 'onboarding-test' } }
  getAuthAndModels.mockResolvedValue(auth)
  getImageInfo.mockReset().mockResolvedValue({ length: 1024, contentType: 'application/pdf', metadata: { userId: String(userId), category: 'documents' } })
})

test('partial employee upload is persisted as pending in both checklist and document register', async () => {
  const response = await POST(request({ employeeId: String(new mongoose.Types.ObjectId()), itemKey: 'documents', verification: { details: {}, documents: [evidence()] } }))
  expect(response.status).toBe(200)
  const employee = await models.Employee.findById(employeeId).lean()
  const item = employee.lifecycle.onboarding.checklist.find(item => item.key === 'documents')
  expect(item.completed).toBe(false)
  expect(item.submission.status).toBe('pending')
  expect(item.submission.verification.documents).toHaveLength(1)
  const document = await models.Document.findOne({ employee: employeeId }).lean()
  expect(document).toMatchObject({ status: 'pending', onboardingItemKey: 'documents', fileId })
  const loaded = await (await GET(new Request('https://talio.test'))).json()
  expect(loaded.data.checklist.find(item => item.key === 'documents').submission.status).toBe('pending')
})

test('pending uploads never auto-complete and HR still requires all mandatory evidence', async () => {
  await POST(request({ itemKey: 'documents', verification: { documents: [evidence()] } }))
  const employee = await models.Employee.findById(employeeId).lean()
  const lifecycle = hydrateEmployeeLifecycle(employee)
  expect(reconcileOnboardingChecklist(lifecycle, { documents: { completed: true } }).lifecycle.onboarding.checklist.find(item => item.key === 'documents').completed).toBe(false)
  const verification = lifecycle.onboarding.checklist.find(item => item.key === 'documents').submission.verification
  expect(() => applyLifecycleAction(lifecycle, 'complete_onboarding_item', { itemKey: 'documents', verification }, { actorId: auth.user._id, employee })).toThrow('PAN card must be uploaded')
})

test('HR can request changes; employee resubmission clears feedback and stays pending', async () => {
  await POST(request({ itemKey: 'documents', verification: { documents: [evidence()] } }))
  const employee = await models.Employee.findById(employeeId).lean()
  const result = applyLifecycleAction(hydrateEmployeeLifecycle(employee), 'request_onboarding_changes', { itemKey: 'documents', reason: 'Upload a readable copy' }, { actorId: auth.user._id, employee })
  await models.Employee.updateOne({ _id: employeeId }, { $set: { lifecycle: result.lifecycle } })
  expect((await POST(request({ itemKey: 'documents', verification: { documents: [evidence()] } }))).status).toBe(200)
  const item = (await models.Employee.findById(employeeId).lean()).lifecycle.onboarding.checklist.find(item => item.key === 'documents')
  expect(item.submission).toMatchObject({ status: 'pending', reviewReason: '' })
})

test('full evidence approval is auditable and cannot be overwritten by employee', async () => {
  const documents = getOnboardingVerificationRequirement('documents').uploads.filter(upload => upload.required).map(upload => evidence(upload.key))
  await POST(request({ itemKey: 'documents', verification: { documents } }))
  const employee = await models.Employee.findById(employeeId).lean()
  const result = applyLifecycleAction(hydrateEmployeeLifecycle(employee), 'complete_onboarding_item', { itemKey: 'documents', verification: { documents } }, { actorId: auth.user._id, employee })
  const item = result.lifecycle.onboarding.checklist.find(item => item.key === 'documents')
  expect(item).toMatchObject({ completed: true, submission: { status: 'approved' }, verification: { status: 'verified' } })
  await models.Employee.updateOne({ _id: employeeId }, { $set: { lifecycle: result.lifecycle } })
  expect((await POST(request({ itemKey: 'documents', verification: { documents } }))).status).toBe(409)
})

test('rejects files owned by another user and forged register metadata', async () => {
  getImageInfo.mockResolvedValue({ length: 1024, contentType: 'application/pdf', metadata: { userId: String(new mongoose.Types.ObjectId()), category: 'documents' } })
  await models.Document.create({ employee: employeeId, fileId, name: 'fake.pdf', type: 'application/pdf', url: '/api/images/foreign', status: 'pending' })
  expect((await POST(request({ itemKey: 'documents', verification: { documents: [evidence()] } }))).status).toBe(400)
  expect((await models.Employee.findById(employeeId).lean()).__v).toBe(0)
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
  const other = new mongoose.Types.ObjectId()
  await models.Document.create({ employee: employeeId, fileId, name: 'fake.pdf', type: 'application/pdf', url: '/api/images/foreign', status: 'pending' })
  expect(await canReadDocumentUpload(auth, { fileId, ownerId: String(other) })).toBe(false)
  auth.user.role = 'hr'
  expect(await canReadDocumentUpload(auth, { fileId, ownerId: String(other) })).toBe(false)
  await models.User.collection.insertOne({ _id: other, role: 'hr', email: 'reviewer@example.test' })
  expect(await canReadDocumentUpload(auth, { fileId, ownerId: String(other) })).toBe(true)
  auth.user.role = 'employee'
  expect(await canReadDocumentUpload(auth, { fileId, ownerId: String(other) })).toBe(false)
  await models.Document.updateOne({ fileId }, { status: 'approved' })
  expect(await canReadDocumentUpload(auth, { fileId, ownerId: String(other) })).toBe(true)
})
