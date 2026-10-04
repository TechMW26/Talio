import { Firestore } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { workflowStore } from '../helpers/firestoreWorkflowStore'
import { getAuthAndDatabase, getAuthAndDatabase } from '@/lib/auth'
import { uploadTenantBlob, getTenantBlob, deleteTenantBlob } from '@/lib/platform/blobStorage.server'
import { sendEmail } from '@/lib/mailer'
import { employmentLetterDefaults, validateEmploymentLetter } from '@/lib/hrms/employmentLetter'
import { issueEmploymentLetter } from '@/lib/hrms/employmentLetter.server'
import { generateEmploymentLetterPdf, loadEmploymentLetterLogo } from '@/lib/hrms/employmentLetterPdf.server'
import { GET as download } from '@/app/api/documents/[id]/file/route'
import { GET, POST } from '@/app/api/employees/[id]/letters/route'

jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn(), getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/mailer', () => ({ sendEmail: jest.fn() }))
jest.mock('@/lib/mediaStorage', () => ({ getImage: jest.fn(), getImageInfo: jest.fn() }))
jest.mock('@/lib/platform/blobStorage.server', () => ({ buildTenantRootPrefix: id => `tenants/${id}`, buildTenantBlobPrefix: ({ tenantId, category, ownerId }) => `tenants/${tenantId}/${category}/${ownerId}`, buildAuthenticatedBlobUrl: path => `/api/files/${path}`, getBlobStreamLength: () => null, getTenantBlob: jest.fn(), uploadTenantBlob: jest.fn(), deleteTenantBlob: jest.fn() }))
jest.setTimeout(45000)

export const completeFields = {
  issueDate: '2026-09-29', joiningDate: '2026-10-01', companyName: 'Acme Technologies Private Limited',
  companyAddress: '12 Business Avenue, Pune, Maharashtra 411001, India', employeeName: 'Aman Tiwari', employeeCode: 'TEST-001',
  employeeAddress: '14 Park Road, Pune, Maharashtra 411002, India', designation: 'Software Engineer', department: 'Engineering',
  manager: 'Riya Sharma', workLocation: 'Pune office', employmentType: 'Full-time', salaryAmount: 1200000,
  currency: 'INR', salaryBasis: 'annual CTC', paymentFrequency: 'monthly', workingSchedule: 'Monday to Friday; 09:30 to 18:00 (Asia/Kolkata).',
  probation: 'Three months. Confirmation follows a written performance review.', notice: 'Thirty days written notice by either party, subject to applicable law.',
  benefits: 'Provident Fund and company health insurance apply.', leavePolicy: 'Twenty paid leave days per year plus company-declared holidays.',
  policies: 'Maintain confidentiality of company and client information and comply with the approved company code of conduct.',
  signatoryName: 'Riya Sharma', signatoryTitle: 'Head of Human Resources', compensationBreakdown: 'Annual basic: INR 600,000; HRA: INR 300,000; other allowances: INR 300,000.',
  additionalTerms: '',
}

let firestore, database, auth, context, logo, blobs
beforeAll(async () => {
  if (process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1') {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  }
  const bytes = await sharp('public/fox-icon.png').resize(140, 140).png().toBuffer()
  logo = `data:image/png;base64,${bytes.toString('base64')}`
}, 120000)
afterAll(async () => { await firestore?.terminate() })
beforeEach(async () => {
  database = firestore ? createFirestoreDatabase({ firestore, dataset: `test-letters-${Date.now()}-${randomBytes(5).toString('hex')}`, databaseName: 'talio_company_letter_test', queryFields: { documents: ['sourceKey', 'employee', 'generatedLetter.kind', 'createdAt'], policies: ['applicableTo', 'specificEmployees', 'department'] }, constraints: { documents: [{ fields: ['sourceKey'], sparse: true }] } }) : { ...workflowStore(), databaseName: 'talio_company_letter_test' }
  const employeeId = randomBytes(12).toString('hex'), userId = randomBytes(12).toString('hex')
  await database.create('employees', { _id: employeeId, firstName: 'Aman', lastName: 'Tiwari', employeeCode: 'TEST-001', email: 'aman@example.test' })
  await database.create('users', { _id: userId, employeeId })
  auth = { success: true, user: { _id: userId, employeeId, role: 'hr' }, database, tenant: { databaseName: 'talio_company_letter_test' } }
  getAuthAndDatabase.mockResolvedValue(auth)
  getAuthAndDatabase.mockResolvedValue(auth)
  getFirestoreTenantDatabase.mockResolvedValue(database)
  blobs = new Map()
  uploadTenantBlob.mockImplementation(async ({ tenantId, category, ownerId, body }) => { const pathname = `tenants/${tenantId}/${category}/${ownerId}/${randomBytes(8).toString('hex')}.pdf`; blobs.set(pathname, Buffer.from(body)); return { pathname, access: 'private' } })
  getTenantBlob.mockImplementation(async path => ({ statusCode: 200, stream: new Response(blobs.get(path)).body }))
  deleteTenantBlob.mockImplementation(async path => { blobs.delete(path) })
  context = { employee: { _id: employeeId, email: 'aman@example.test' }, logo, actorEmployeeId: employeeId }
  sendEmail.mockReset().mockResolvedValue({ accepted: ['aman@example.test'], rejected: [], messageId: 'test-message' })
})

test('prefills actual records without inventing missing salary or employment terms', () => {
  const fields = employmentLetterDefaults({ employee: { firstName: 'Aman', lastName: 'Tiwari' }, preferences: { companyName: 'Your Company' } })
  expect(fields).toMatchObject({ employeeName: 'Aman Tiwari', salaryAmount: '', companyName: '', benefits: '', notice: '', probation: '' })
  const configured = employmentLetterDefaults({ employee: { salary: { grossSalary: 40000 } }, settings: { workingDays: ['Monday'], checkInTime: '09:00', checkOutTime: '18:00' } })
  expect(configured.workingSchedule).toContain('Monday; 09:00 to 18:00')
  expect(configured.salaryAmount).toBe(40000)
})

test.each([
  ['manager', ''], ['benefits', '[Benefits]'], ['notice', 'TBD'], ['joiningDate', '2026-02-31'],
  ['salaryAmount', 0], ['salaryAmount', 'Infinity'], ['paymentFrequency', 'daily'], ['companyName', 'x'.repeat(161)],
])('rejects incomplete or placeholder field %s', (key, value) => {
  expect(() => validateEmploymentLetter('offer', { ...completeFields, [key]: value })).toThrow()
})

test('requires an uploaded, tenant-scoped company logo', async () => {
  await expect(loadEmploymentLetterLogo('', 'talio_company_letter_test')).rejects.toThrow('company logo')
  await expect(loadEmploymentLetterLogo('https://untrusted.test/logo.png', 'talio_company_letter_test')).rejects.toThrow('company settings')
  await expect(loadEmploymentLetterLogo('/api/files/tenants/other/logo.png', 'talio_company_letter_test')).rejects.toThrow('company settings')
})

test('issues one real PDF, persists it and emails those exact bytes once', async () => {
  const payload = { kind: 'appointment', fields: completeFields, sendEmail: true }
  const [first, second] = await Promise.all([issueEmploymentLetter(auth, context, payload), issueEmploymentLetter(auth, context, payload)])
  expect(String(first.document._id)).toBe(String(second.document._id))
  expect(await database.count('documents')).toBe(1)
  expect(sendEmail).toHaveBeenCalledTimes(1)
  const document = await database.get('documents', first.document._id)
  const bytes = blobs.get(document.storage.pathname)
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  expect(document.status).toBe('issued')
  expect(document.generatedLetter.fields.employeeName).toBe('Aman Tiwari')
  expect(document.emailDelivery.status).toBe('sent')
  expect(sendEmail.mock.calls[0][0].attachments[0].content).toEqual(bytes)
  expect(document.generatedPdf).toBeUndefined()
  await issueEmploymentLetter(auth, context, payload)
  expect(sendEmail).toHaveBeenCalledTimes(1)
})

test('employee can download own PDF but another employee cannot', async () => {
  const issued = await issueEmploymentLetter(auth, context, { kind: 'offer', fields: completeFields, sendEmail: false })
  const params = { params: Promise.resolve({ id: String(issued.document._id) }) }
  auth.user.role = 'employee'
  const response = await download(new Request('https://talio.test'), params)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('application/pdf')
  expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-')
  await database.mutate('users', auth.user._id, user => ({ ...user, employeeId: randomBytes(12).toString('hex') }))
  expect((await download(new Request('https://talio.test'), params)).status).toBe(403)
})

test('duplicate issuance cleans up the redundant private Blob upload', async () => {
  const payload = { kind: 'offer', fields: completeFields, sendEmail: true }
  await Promise.all([issueEmploymentLetter(auth, context, payload), issueEmploymentLetter(auth, context, payload)])
  expect(await database.count('documents')).toBe(1)
  expect(blobs.size).toBe(1)
  expect(sendEmail).toHaveBeenCalledTimes(1)
})

test('rejected email preserves the PDF and allows a corrected retry', async () => {
  sendEmail.mockResolvedValueOnce({ accepted: [], rejected: ['aman@example.test'] })
  const payload = { kind: 'offer', fields: completeFields, sendEmail: true }
  const failed = await issueEmploymentLetter(auth, context, payload)
  expect(failed.document.emailDelivery.status).toBe('failed')
  expect(failed.emailError).toContain('PDF is saved')
  const sent = await issueEmploymentLetter(auth, context, payload)
  expect(sent.document.emailDelivery.status).toBe('sent')
  expect(await database.count('documents')).toBe(1)
})

test('uncertain email outcome does not resend on repeated clicks', async () => {
  sendEmail.mockRejectedValueOnce(Object.assign(new Error('SMTP acknowledgement timed out'), { code: 'ETIMEDOUT' }))
  const payload = { kind: 'offer', fields: completeFields, sendEmail: true }
  expect((await issueEmploymentLetter(auth, context, payload)).document.emailDelivery.status).toBe('unknown')
  expect((await issueEmploymentLetter(auth, context, payload)).emailError).toContain('unconfirmed')
  expect(sendEmail).toHaveBeenCalledTimes(1)
})

test('letter routes require HR/admin role and valid employee identity', async () => {
  const params = { params: Promise.resolve({ id: String(context.employee._id) }) }
  auth.user.role = 'employee'
  expect((await GET(new Request('https://talio.test'), params)).status).toBe(403)
  expect((await POST(new Request('https://talio.test', { method: 'POST', body: '{}' }), params)).status).toBe(403)
  auth.user.role = 'hr'
  expect((await GET(new Request('https://talio.test'), { params: Promise.resolve({ id: 'invalid' }) })).status).toBe(400)
  const loaded = await (await GET(new Request('https://talio.test'), params)).json()
  expect(loaded.data.defaults.employeeName).toBe('Aman Tiwari')
})

test('HTTP issuance stores the PDF in the target employee register and returns a working private download', async () => {
  await database.create('companysettings', { _id: 'company', companyName: completeFields.companyName, companyLogo: logo })
  const response = await POST(new Request('https://talio.test', { method: 'POST', body: JSON.stringify({ kind: 'appointment', fields: completeFields, sendEmail: false }) }), { params: Promise.resolve({ id: String(context.employee._id) }) })
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.success).toBe(true)
  const document = await database.get('documents', body.data._id)
  expect(document).toMatchObject({ category: 'employment', status: 'issued', fileUrl: body.data.fileUrl })
  const pdf = await download(new Request('https://talio.test'), { params: Promise.resolve({ id: body.data._id }) })
  expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-')
  expect(sendEmail).not.toHaveBeenCalled()
})

test('renders complete multi-page letter samples for layout QA when requested', async () => {
  const image = await loadEmploymentLetterLogo(logo, 'talio_company_letter_test')
  const fields = validateEmploymentLetter('appointment', completeFields)
  const bytes = generateEmploymentLetterPdf({ kind: 'appointment', fields, logo: image, reference: 'HR/TEST-001/20260929/ABCDEF12' })
  expect(bytes.length).toBeGreaterThan(2000)
  if (process.env.LETTER_PDF_QA === '1') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'talio-letter-qa-'))
    fs.writeFileSync(path.join(directory, 'appointment.pdf'), bytes)
    fs.writeFileSync(path.join(directory, 'offer.pdf'), generateEmploymentLetterPdf({ kind: 'offer', fields: { ...fields, additionalTerms: 'Agreed working arrangements and responsibilities will be reviewed with the reporting manager. '.repeat(45) }, logo: image, reference: 'HR/TEST-001/20260929/OFFER123' }))
    console.info('PDF layout samples:', directory)
  }
})
