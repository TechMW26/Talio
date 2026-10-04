import { Firestore } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getResignationStore } from '@/lib/hrms/resignationStore.server'
import { POST, GET } from '@/app/api/resignations/[id]/exit/route'
import { acceptAndStartExit, assertExitReady, finaliseExit, emailExitDocument } from '@/lib/hrms/resignationExit.server'
import { sendEmail } from '@/lib/mailer'
import { loadEmploymentLetterLogo } from '@/lib/hrms/employmentLetterPdf.server'
import { uploadTenantBlob, getTenantBlob, deleteTenantBlob } from '@/lib/platform/blobStorage.server'

jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/hrms/resignationStore.server', () => ({ ...jest.requireActual('@/lib/hrms/resignationStore.server'), getResignationStore: jest.fn() }))
jest.mock('@/lib/platform/blobStorage.server', () => ({ ...jest.requireActual('@/lib/platform/blobStorage.server'), uploadTenantBlob: jest.fn(), getTenantBlob: jest.fn(), deleteTenantBlob: jest.fn() }))
jest.mock('@/lib/cache', () => ({ clearCachePattern: jest.fn().mockResolvedValue(true), buildCachePattern: jest.fn(() => 'tenant:scope') }))
jest.mock('@/lib/mailer', () => ({ sendEmail: jest.fn() }))
jest.mock('@/lib/hrms/employmentLetterPdf.server', () => ({ ...jest.requireActual('@/lib/hrms/employmentLetterPdf.server'), loadEmploymentLetterLogo: jest.fn().mockResolvedValue(null) }))
jest.setTimeout(45000)
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
suite('native exit workflow against isolated Firestore emulator', () => {
let firestore, store, employee, hr, user, record, auth, blobs
const now = new Date(), today = now.toISOString().slice(0, 10)
const settlement = () => ({ date: today, currency: 'INR', items: [{ label: 'Final salary', type: 'earning', amount: 5000 }, { label: 'Approved recovery', type: 'deduction', amount: 1000 }], notes: 'Reviewed by HR' })
const confirmations = () => ({ version: record.version, paymentReference: 'BANK-TEST-001', handoverConfirmed: true, accessConfirmed: true, settlementConfirmed: true })
const oid = () => randomBytes(12).toString('hex')
beforeAll(() => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
  firestore = new Firestore({ projectId: 'demo-talio-firestore' })
})
afterAll(async () => { await firestore?.terminate() })
beforeEach(async () => {
  jest.clearAllMocks()
  store = createFirestoreDatabase({ firestore, dataset: `test-exit-${Date.now()}-${oid()}`, databaseName: 'talio_company_test', queryFields: { users: ['employeeId'], usersessions: ['user', 'isActive'], assets: ['assignedTo'] }, constraints: { documents: [{ fields: ['sourceKey'], sparse: true }] } })
  getResignationStore.mockResolvedValue(store)
  user = { _id: oid(), employeeId: oid(), role: 'employee', email: 'employee@example.test', isActive: true }
  hr = { _id: oid(), employeeId: oid(), role: 'hr', email: 'hr@example.test', isActive: true }
  employee = { _id: user.employeeId, firstName: 'Test', lastName: 'Employee', employeeCode: 'QA001', email: user.email, status: 'active', dateOfJoining: new Date('2025-01-01'), __v: 0 }
  for (const account of [user, hr]) await store.create('users', account)
  for (const entry of [employee, { _id: hr.employeeId, firstName: 'Test', lastName: 'HR', employeeCode: 'QA002', email: hr.email }]) await store.create('employees', entry)
  await store.create('companysettings', { _id: oid(), companyName: 'Quality Assurance Company', companyAddress: '123 Test Avenue, Pune, India' })
  await store.create('usersessions', { _id: oid(), user: user._id, tokenId: 'test-token', isActive: true, expiresAt: new Date(Date.now() + 100000) })
  record = { _id: oid(), employee: employee._id, requestedBy: user._id, status: 'employee_review', active: true, version: 0, reason: 'Personal relocation', reviewers: [], proposal: { noticeDays: 0, noticeStartDate: new Date(today), lastWorkingDate: new Date(today), reason: 'Immediate release approved' }, createdAt: new Date(today), timeline: [] }
  await store.create('resignationrequests', record)
  record = await acceptAndStartExit(store, record, { version: 0 }, { status: 'accepted' }, { action: 'accept', actor: user._id, at: now })
  auth = { success: true, user: hr, tenant: { databaseName: store.databaseName } }
  getAuthAndDatabase.mockImplementation(async () => auth)
  sendEmail.mockResolvedValue({ accepted: [user.email], rejected: [], messageId: 'qa-message' })
  loadEmploymentLetterLogo.mockResolvedValue(null)
  blobs = new Map()
  uploadTenantBlob.mockImplementation(async ({ body, tenantId, ownerId }) => { const pathname = `tenants/${tenantId}/documents/${ownerId}/${oid()}.pdf`; blobs.set(pathname, body); return { provider: 'vercel-blob', access: 'private', pathname } })
  getTenantBlob.mockImplementation(async path => ({ statusCode: 200, stream: new Response(blobs.get(path)).body }))
  deleteTenantBlob.mockImplementation(async path => blobs.delete(path))
})
const request = body => ({ json: async () => body })
const route = body => POST(request(body), { params: Promise.resolve({ id: String(record._id) }) })
async function save() {
  const response = await route({ action: 'save_settlement', version: record.version, settlement: settlement() })
  expect(await response.json()).toMatchObject({ success: true })
  record = await store.get('resignationrequests', record._id)
}
test('acceptance atomically starts linked offboarding without resigning employee', async () => {
  const saved = await store.get('employees', employee._id)
  expect(String(saved.lifecycle.offboarding.resignationRequest)).toBe(String(record._id))
  expect(saved.lifecycle.offboarding.status).toBe('in_progress')
  expect(saved.status).toBe('active')
  expect(await store.count('documents')).toBe(0)
})
test('settlement persists in the actual schema and stale saves are rejected', async () => {
  await save()
  const saved = await store.get('employees', employee._id)
  expect(saved.lifecycle.offboarding.settlement.netAmount).toBe(4000)
  expect((await route({ action: 'save_settlement', version: 1, settlement: settlement() })).status).toBe(409)
})
test('completion is atomic, stores a PDF, revokes sessions and emails only once on retry', async () => {
  await save()
  expect((await route({ action: 'finalise', ...confirmations() })).status).toBe(200)
  expect((await store.get('employees', employee._id)).status).toBe('resigned')
  expect((await store.get('users', user._id)).isActive).toBe(false)
  expect((await store.list('usersessions', { filters: [{ field: 'user', operator: '==', value: user._id }] }).then(page => page.records[0])).isActive).toBe(false)
  const doc = await store.list('documents', { limit: 1 }).then(page => page.records[0])
  expect(doc.generatedPdf).toBeUndefined()
  expect(blobs.get(doc.storage.pathname).subarray(0, 4).toString()).toBe('%PDF')
  expect(sendEmail.mock.calls[0][0].attachments[0].content.subarray(0, 4).toString()).toBe('%PDF')
  expect(doc.emailDelivery.status).toBe('sent')
  expect((await route({ action: 'finalise', ...confirmations() })).status).toBe(200)
  expect(await store.count('documents')).toBe(1)
  expect(sendEmail).toHaveBeenCalledTimes(1)
})
test('known email failure is visible and retry does not repeat exit', async () => {
  await save(); sendEmail.mockRejectedValueOnce(Object.assign(new Error('Recipient rejected'), { code: 'EENVELOPE' }))
  const response = await route({ action: 'finalise', ...confirmations() })
  expect((await response.json()).email.status).toBe('failed')
  expect((await route({ action: 'send_documents' })).status).toBe(200)
  expect(await store.count('documents')).toBe(1)
  expect(sendEmail).toHaveBeenCalledTimes(2)
})
test('concurrent finalisation creates one document and sends one email', async () => {
  await save()
  const responses = await Promise.all([route({ action: 'finalise', ...confirmations() }), route({ action: 'finalise', ...confirmations() })])
  expect(responses.map(response => response.status).sort()).toEqual([200, 409])
  expect(await store.count('documents')).toBe(1)
  expect(sendEmail).toHaveBeenCalledTimes(1)
})
test('disabled exit-management feature rejects settlement changes', async () => {
  auth.companyFeatures = { exitManagement: false }
  expect((await route({ action: 'save_settlement', version: record.version, settlement: settlement() })).status).toBe(403)
})
test('ambiguous mail failures are not automatically resent', async () => {
  await save(); sendEmail.mockRejectedValue(new Error('Connection dropped after DATA'))
  const doc = await finaliseExit(auth, hr, record, confirmations())
  expect((await emailExitDocument(store, doc)).status).toBe('unknown')
  expect((await emailExitDocument(store, doc)).status).toBe('unknown')
  expect(sendEmail).toHaveBeenCalledTimes(1)
})
test('transaction rolls back resignation and account updates when document insert fails', async () => {
  await save()
  const failing = { ...store, transaction: callback => store.transaction(tx => callback({ ...tx, create: (name, record) => name === 'documents' ? Promise.reject(new Error('Database unavailable')) : tx.create(name, record) })) }
  getResignationStore.mockResolvedValueOnce(failing)
  await expect(finaliseExit(auth, hr, record, confirmations())).rejects.toThrow('Database unavailable')
  expect(deleteTenantBlob).toHaveBeenCalledTimes(1)
  expect((await store.get('resignationrequests', record._id)).status).toBe('accepted')
  expect((await store.get('employees', employee._id)).status).toBe('active')
  expect((await store.get('users', user._id)).isActive).toBe(true)
})
test('assigned assets block completion even when client confirms everything', async () => {
  await save()
  await store.create('assets', { _id: oid(), assignedTo: employee._id, name: 'Test laptop', assetCode: 'QA-LAPTOP' })
  expect((await route({ action: 'finalise', ...confirmations() })).status).toBe(400)
  expect(await store.count('documents')).toBe(0)
})
test('employee can read own exit but cannot finalise it', async () => {
  auth.user = user
  expect((await GET({}, { params: { id: String(record._id) } })).status).toBe(200)
  expect((await route({ action: 'finalise', ...confirmations() })).status).toBe(403)
})
test('another employee cannot read exit financial details', async () => {
  await store.mutate('users', hr._id, current => ({ ...current, role: 'employee' }))
  expect((await GET({}, { params: { id: String(record._id) } })).status).toBe(404)
})
test('future working date and missing confirmations or calculation block finalisation', () => {
  const offboarding = { assetsReturned: true, settlement: { ...settlement(), savedAt: now } }
  expect(() => assertExitReady({ ...record, proposal: { lastWorkingDate: new Date('2099-01-01') } }, offboarding, confirmations())).toThrow('last working date')
  expect(() => assertExitReady(record, offboarding, { ...confirmations(), handoverConfirmed: false })).toThrow('Confirm handover')
  expect(() => assertExitReady(record, { assetsReturned: true }, confirmations())).toThrow('calculation')
})

})
