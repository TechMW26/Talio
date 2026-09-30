import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { getTenantConnection } from '@/lib/tenantDb'
import { getTenantModels } from '@/lib/tenantModels'
import { getAuthAndModels } from '@/lib/auth'
import { POST, GET } from '@/app/api/resignations/[id]/exit/route'
import { acceptAndStartExit, assertExitReady, finaliseExit, emailExitDocument } from '@/lib/hrms/resignationExit.server'
import { sendEmail } from '@/lib/mailer'
import { loadEmploymentLetterLogo } from '@/lib/hrms/employmentLetterPdf.server'

jest.mock('@/lib/tenantDb', () => ({ getTenantConnection: jest.fn() }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/cache', () => ({ clearCachePattern: jest.fn().mockResolvedValue(true), buildCachePattern: jest.fn(() => 'tenant:scope') }))
jest.mock('@/lib/mailer', () => ({ sendEmail: jest.fn() }))
jest.mock('@/lib/hrms/employmentLetterPdf.server', () => ({ ...jest.requireActual('@/lib/hrms/employmentLetterPdf.server'), loadEmploymentLetterLogo: jest.fn().mockResolvedValue(null) }))
let replica, connection, models, employee, hr, user, record, auth
const now = new Date(), today = now.toISOString().slice(0, 10)
const settlement = () => ({ date: today, currency: 'INR', items: [{ label: 'Final salary', type: 'earning', amount: 5000 }, { label: 'Approved recovery', type: 'deduction', amount: 1000 }], notes: 'Reviewed by HR' })
const confirmations = () => ({ version: record.version, paymentReference: 'BANK-TEST-001', handoverConfirmed: true, accessConfirmed: true, settlementConfirmed: true })
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  connection = await mongoose.createConnection(replica.getUri()).asPromise()
  getTenantConnection.mockResolvedValue(connection)
  models = await getTenantModels('resignation-exit-test', ['ResignationRequest', 'Employee', 'User', 'UserSession', 'Asset', 'Document', 'Company', 'CompanySettings', 'SystemPreferences'])
  await Promise.all(Object.values(models).map(model => model.init()))
}, 120000)
afterAll(async () => { await connection?.close(); await replica?.stop() })
beforeEach(async () => {
  jest.clearAllMocks()
  await Promise.all(Object.values(models).map(model => model.deleteMany({})))
  const oid = () => new mongoose.Types.ObjectId()
  user = { _id: oid(), employeeId: oid(), role: 'employee', email: 'employee@example.test', isActive: true }
  hr = { _id: oid(), employeeId: oid(), role: 'hr', email: 'hr@example.test', isActive: true }
  employee = { _id: user.employeeId, firstName: 'Test', lastName: 'Employee', employeeCode: 'QA001', email: user.email, status: 'active', dateOfJoining: new Date('2025-01-01'), __v: 0 }
  await models.User.collection.insertMany([user, hr])
  await models.Employee.collection.insertMany([employee, { _id: hr.employeeId, firstName: 'Test', lastName: 'HR', employeeCode: 'QA002', email: hr.email }])
  await models.CompanySettings.collection.insertOne({ companyName: 'Quality Assurance Company', companyAddress: '123 Test Avenue, Pune, India' })
  await models.UserSession.collection.insertOne({ user: user._id, tokenId: 'test-token', isActive: true, expiresAt: new Date(Date.now() + 100000) })
  record = await models.ResignationRequest.create({ employee: employee._id, requestedBy: user._id, status: 'employee_review', active: true, version: 0, reason: 'Personal relocation', reviewers: [], proposal: { noticeDays: 0, noticeStartDate: new Date(today), lastWorkingDate: new Date(today), reason: 'Immediate release approved' }, createdAt: new Date(today), timeline: [] })
  record = await acceptAndStartExit(models, record.toObject(), { version: 0 }, { status: 'accepted' }, { action: 'accept', actor: user._id, at: now })
  auth = { success: true, user: hr, models, tenant: { databaseName: 'resignation-exit-test' } }
  getAuthAndModels.mockImplementation(async () => auth)
  sendEmail.mockResolvedValue({ accepted: [user.email], rejected: [], messageId: 'qa-message' })
  loadEmploymentLetterLogo.mockResolvedValue(null)
})
const request = body => ({ json: async () => body })
const route = body => POST(request(body), { params: Promise.resolve({ id: String(record._id) }) })
async function save() {
  const response = await route({ action: 'save_settlement', version: record.version, settlement: settlement() })
  expect(await response.json()).toMatchObject({ success: true })
  record = await models.ResignationRequest.findById(record._id).lean()
}
test('acceptance atomically starts linked offboarding without resigning employee', async () => {
  const saved = await models.Employee.findById(employee._id).lean()
  expect(String(saved.lifecycle.offboarding.resignationRequest)).toBe(String(record._id))
  expect(saved.lifecycle.offboarding.status).toBe('in_progress')
  expect(saved.status).toBe('active')
  expect(await models.Document.countDocuments()).toBe(0)
})
test('settlement persists in the actual schema and stale saves are rejected', async () => {
  await save()
  const saved = await models.Employee.findById(employee._id).lean()
  expect(saved.lifecycle.offboarding.settlement.netAmount).toBe(4000)
  expect((await route({ action: 'save_settlement', version: 1, settlement: settlement() })).status).toBe(409)
})
test('completion is atomic, stores a PDF, revokes sessions and emails only once on retry', async () => {
  await save()
  expect((await route({ action: 'finalise', ...confirmations() })).status).toBe(200)
  expect((await models.Employee.findById(employee._id).lean()).status).toBe('resigned')
  expect((await models.User.findById(user._id).lean()).isActive).toBe(false)
  expect((await models.UserSession.findOne({ user: user._id }).lean()).isActive).toBe(false)
  const doc = await models.Document.findOne().select('+generatedPdf').lean()
  expect(Buffer.from(doc.generatedPdf.buffer).subarray(0, 4).toString()).toBe('%PDF')
  expect(sendEmail.mock.calls[0][0].attachments[0].content.subarray(0, 4).toString()).toBe('%PDF')
  expect(doc.emailDelivery.status).toBe('sent')
  expect((await route({ action: 'finalise', ...confirmations() })).status).toBe(200)
  expect(await models.Document.countDocuments()).toBe(1)
  expect(sendEmail).toHaveBeenCalledTimes(1)
})
test('known email failure is visible and retry does not repeat exit', async () => {
  await save(); sendEmail.mockRejectedValueOnce(Object.assign(new Error('Recipient rejected'), { code: 'EENVELOPE' }))
  const response = await route({ action: 'finalise', ...confirmations() })
  expect((await response.json()).email.status).toBe('failed')
  expect((await route({ action: 'send_documents' })).status).toBe(200)
  expect(await models.Document.countDocuments()).toBe(1)
  expect(sendEmail).toHaveBeenCalledTimes(2)
})
test('concurrent finalisation creates one document and sends one email', async () => {
  await save()
  const responses = await Promise.all([route({ action: 'finalise', ...confirmations() }), route({ action: 'finalise', ...confirmations() })])
  expect(responses.map(response => response.status).sort()).toEqual([200, 409])
  expect(await models.Document.countDocuments()).toBe(1)
  expect(sendEmail).toHaveBeenCalledTimes(1)
})
test('disabled exit-management feature rejects settlement changes', async () => {
  auth.companyFeatures = { exitManagement: false }
  expect((await route({ action: 'save_settlement', version: record.version, settlement: settlement() })).status).toBe(403)
})
test('ambiguous mail failures are not automatically resent', async () => {
  await save(); sendEmail.mockRejectedValue(new Error('Connection dropped after DATA'))
  const doc = await finaliseExit(auth, hr, record, confirmations())
  expect((await emailExitDocument(models, doc)).status).toBe('unknown')
  expect((await emailExitDocument(models, doc)).status).toBe('unknown')
  expect(sendEmail).toHaveBeenCalledTimes(1)
})
test('transaction rolls back resignation and account updates when document insert fails', async () => {
  await save()
  const spy = jest.spyOn(models.Document, 'create').mockRejectedValueOnce(new Error('Database unavailable'))
  await expect(finaliseExit(auth, hr, record, confirmations())).rejects.toThrow('Database unavailable')
  spy.mockRestore()
  expect((await models.ResignationRequest.findById(record._id).lean()).status).toBe('accepted')
  expect((await models.Employee.findById(employee._id).lean()).status).toBe('active')
  expect((await models.User.findById(user._id).lean()).isActive).toBe(true)
})
test('assigned assets block completion even when client confirms everything', async () => {
  await save()
  await models.Asset.collection.insertOne({ assignedTo: employee._id, name: 'Test laptop', assetCode: 'QA-LAPTOP' })
  expect((await route({ action: 'finalise', ...confirmations() })).status).toBe(400)
  expect(await models.Document.countDocuments()).toBe(0)
})
test('employee can read own exit but cannot finalise it', async () => {
  auth.user = user
  expect((await GET({}, { params: { id: String(record._id) } })).status).toBe(200)
  expect((await route({ action: 'finalise', ...confirmations() })).status).toBe(403)
})
test('another employee cannot read exit financial details', async () => {
  await models.User.updateOne({ _id: hr._id }, { $set: { role: 'employee' } })
  expect((await GET({}, { params: { id: String(record._id) } })).status).toBe(404)
})
test('future working date and missing confirmations or calculation block finalisation', () => {
  const offboarding = { assetsReturned: true, settlement: { ...settlement(), savedAt: now } }
  expect(() => assertExitReady({ ...record, proposal: { lastWorkingDate: new Date('2099-01-01') } }, offboarding, confirmations())).toThrow('last working date')
  expect(() => assertExitReady(record, offboarding, { ...confirmations(), handoverConfirmed: false })).toThrow('Confirm handover')
  expect(() => assertExitReady(record, { assetsReturned: true }, confirmations())).toThrow('calculation')
})
