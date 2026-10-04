import { randomBytes } from 'node:crypto'
import { workflowStore } from '../helpers/firestoreWorkflowStore'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { getAuthAndDatabase } from '@/lib/auth'
import { getImage, getImageInfo } from '@/lib/mediaStorage'
import { inspectInductionFile, publishInduction, inductionStatus, updateInductionProgress, progressId, inductionSettings } from '@/lib/hrms/induction.server'
import { POST as settings } from '@/app/api/induction/settings/route'
import { GET as file } from '@/app/api/induction/file/route'
import { GET, POST } from '@/app/api/induction/route'

jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/mediaStorage', () => ({ getImage: jest.fn(), getImageInfo: jest.fn() }))
jest.mock('@/lib/platform/blobStorage.server', () => ({ buildTenantRootPrefix: id => `tenants/${id}`, buildTenantBlobPrefix: ({ tenantId, ownerId }) => `tenants/${tenantId}/documents/${ownerId}`, getTenantBlob: jest.fn() }))
let database, auth, bytes, employee, source
const oid = () => randomBytes(12).toString('hex')
const request = input => new Request('https://talio.test/api/induction', { method: 'POST', body: JSON.stringify(input) })
const publish = previousVersion => publishInduction(auth, { title: 'Company orientation', source, previousVersion, previewConfirmed: true })
beforeAll(async () => {
  const pdf = await PDFDocument.create(); pdf.addPage().drawText('Welcome'); pdf.addPage().drawText('Acknowledgement')
  bytes = Buffer.from(await pdf.save())
}, 120000)
beforeEach(async () => {
  database = workflowStore()
  getFirestoreTenantDatabase.mockResolvedValue(database)
  employee = oid()
  const userId = oid()
  await database.create.bind(database, 'employees')({ _id: employee, firstName: 'Induction', lastName: 'Tester' })
  await database.create.bind(database, 'users')({ _id: userId, employeeId: employee })
  auth = { success: true, user: { _id: userId, role: 'hr' }, tenant: { databaseName: 'talio_company_tests' } }
  source = { fileId: String(oid()), fileName: 'orientation.pdf' }
  getAuthAndDatabase.mockResolvedValue(auth)
  getImage.mockResolvedValue(bytes)
  getImageInfo.mockResolvedValue({ length: bytes.length, metadata: { category: 'documents', userId: String(userId) } })
})

test('validates actual PDF and PPTX page counts and rejects unsupported or corrupt files', async () => {
  expect(await inspectInductionFile(bytes, 'test.pdf')).toEqual({ format: 'pdf', pageCount: 2 })
  const zip = new JSZip()
  zip.file('ppt/presentation.xml', '<p:presentation><p:sldIdLst><p:sldId id="1" r:id="s1"/><p:sldId id="2" r:id="s2"/></p:sldIdLst></p:presentation>')
  zip.file('ppt/slides/slide1.xml', '<p:sld/>'); zip.file('ppt/slides/slide2.xml', '<p:sld/>')
  expect(await inspectInductionFile(await zip.generateAsync({ type: 'nodebuffer' }), 'test.pptx')).toEqual({ format: 'pptx', pageCount: 2 })
  await expect(inspectInductionFile(bytes, 'test.ppt')).rejects.toThrow('legacy')
  await expect(inspectInductionFile(Buffer.from('not a PDF'), 'test.pdf')).rejects.toThrow('valid PDF')
  zip.remove('ppt/slides/slide2.xml')
  await expect(inspectInductionFile(await zip.generateAsync({ type: 'nodebuffer' }), 'test.pptx')).rejects.toThrow('damaged')
})

test('no published content does not block users; publication makes acknowledgement mandatory', async () => {
  expect((await inductionStatus(auth)).required).toBe(false)
  const program = await publish()
  expect(program.pageCount).toBe(2)
  expect((await inductionStatus(auth)).required).toBe(true)
  expect((await (await GET(new Request('https://talio.test'))).json()).data.program).not.toHaveProperty('source')
})

test('cannot skip pages or complete without an explicit acknowledgement', async () => {
  const { version } = await publish()
  await expect(updateInductionProgress(auth, { version, action: 'page', page: 2 })).rejects.toThrow('in order')
  await expect(updateInductionProgress(auth, { version, action: 'acknowledge', acknowledged: true })).rejects.toThrow('every page')
  await updateInductionProgress(auth, { version, action: 'page', page: 1 })
  await updateInductionProgress(auth, { version, action: 'page', page: 2 })
  await expect(updateInductionProgress(auth, { version, action: 'acknowledge', acknowledged: false })).rejects.toThrow('Confirm')
})

test('progress survives new requests, completion is idempotent and stores the employee tag', async () => {
  const { version } = await publish()
  await updateInductionProgress(auth, { version, action: 'page', page: 1 })
  expect((await inductionStatus(auth)).progress.viewedThrough).toBe(1)
  await updateInductionProgress(auth, { version, action: 'page', page: 2 })
  const [one, two] = await Promise.all([1, 2].map(() => updateInductionProgress(auth, { version, action: 'acknowledge', acknowledged: true })))
  expect(one.acknowledgedAt).toEqual(two.acknowledgedAt)
  expect((await inductionStatus(auth)).required).toBe(false)
  expect((await database.get('employees', employee)).inductionCompletion.version).toBe(version)
  expect(await database.count('inductionprogresses')).toBe(1)
})

test('publishing a new version requires acknowledgement again and preserves prior history', async () => {
  const { version } = await publish()
  await updateInductionProgress(auth, { version, action: 'page', page: 1 })
  await updateInductionProgress(auth, { version, action: 'page', page: 2 })
  await updateInductionProgress(auth, { version, action: 'acknowledge', acknowledged: true })
  const replacement = await publish(version)
  expect(replacement.version).not.toBe(version)
  expect((await inductionStatus(auth)).required).toBe(true)
  expect((await database.get('inductionprogresses', progressId(employee, version))).acknowledgedAt).toBeTruthy()
  await expect(updateInductionProgress(auth, { version, action: 'page', page: 1 })).rejects.toThrow('changed')
  await expect(publish(version)).rejects.toThrow('changed')
})

test('only HR/admin can publish or withdraw and withdrawal releases the mandatory gate', async () => {
  auth.user.role = 'employee'
  expect((await settings(request({ action: 'publish', title: 'Test', source, previewConfirmed: true }))).status).toBe(403)
  auth.user.role = 'hr'
  const { version } = await publish()
  expect((await settings(request({ action: 'withdraw', previousVersion: version }))).status).toBe(200)
  expect((await inductionStatus(auth)).required).toBe(false)
})

test('requires preview confirmation and rejects another users upload', async () => {
  await expect(publishInduction(auth, { title: 'Test', source })).rejects.toThrow('Preview')
  getImageInfo.mockResolvedValue({ length: 100, metadata: { category: 'documents', userId: String(oid()) } })
  await expect(publish()).rejects.toThrow('own account')
})

test('legacy employee-to-user links still require induction', async () => {
  await publish()
  await database.mutate('users', auth.user._id, current => ({ ...current, employeeId: undefined }))
  await database.mutate('employees', employee, current => ({ ...current, userId: auth.user._id }))
  expect((await inductionStatus(auth)).required).toBe(true)
})

test('file delivery is authenticated and bound to the current tenant version', async () => {
  const { version } = await publish()
  expect((await file(new Request(`https://talio.test/api/induction/file?version=${version}`))).status).toBe(200)
  expect((await file(new Request('https://talio.test/api/induction/file?version=another-tenant-version'))).status).toBe(409)
  auth.success = false
  expect((await file(new Request(`https://talio.test/api/induction/file?version=${version}`))).status).toBe(401)
  expect((await POST(request({ action: 'page', version, page: 1 }))).status).toBe(401)
})

test('company cards show tenant companies and independent module versions', async () => {
  const a = await database.create('companies', { _id: oid(), isActive: true, name: 'Company A', code: 'A' })
  const b = await database.create('companies', { _id: oid(), isActive: true, name: 'Company B', code: 'B' })
  const global = await publish()
  const moduleA = await publishInduction(auth, { companyId: String(a._id), title: 'A orientation', source, previewConfirmed: true })
  const catalog = await inductionSettings(auth, String(a._id))
  expect(catalog.companies).toHaveLength(2)
  expect(catalog.program.version).toBe(moduleA.version)
  expect(catalog.defaultProgram.version).toBe(global.version)
  expect(catalog.companies.find(item => item.id === String(b._id)).program).toBeNull()
  await expect(publishInduction(auth, { companyId: String(oid()), title: 'Outside', source, previewConfirmed: true })).rejects.toMatchObject({ status: 404 })
  auth.user.role = 'employee'
  await expect(inductionSettings(auth)).rejects.toMatchObject({ status: 403 })
})

test('employees receive only their assigned company module, including after transfers', async () => {
  const a = await database.create('companies', { _id: oid(), isActive: true, name: 'Company A' })
  const b = await database.create('companies', { _id: oid(), isActive: true, name: 'Company B' })
  const global = await publish()
  const moduleA = await publishInduction(auth, { companyId: String(a._id), title: 'A orientation', source, previewConfirmed: true })
  const moduleB = await publishInduction(auth, { companyId: String(b._id), title: 'B orientation', source, previewConfirmed: true })
  expect((await inductionStatus(auth)).program.version).toBe(global.version)
  await database.mutate('employees', employee, current => ({ ...current, company: a._id }))
  expect((await inductionStatus(auth)).program.version).toBe(moduleA.version)
  await updateInductionProgress(auth, { version: moduleA.version, action: 'page', page: 1 })
  await updateInductionProgress(auth, { version: moduleA.version, action: 'page', page: 2 })
  await updateInductionProgress(auth, { version: moduleA.version, action: 'acknowledge', acknowledged: true })
  expect((await inductionStatus(auth)).required).toBe(false)
  await database.mutate('employees', employee, current => ({ ...current, company: b._id }))
  expect((await inductionStatus(auth)).required).toBe(true)
  await expect(updateInductionProgress(auth, { companyId: String(a._id), version: moduleA.version, action: 'page', page: 1 })).rejects.toMatchObject({ status: 409 })
  expect((await file(new Request(`https://talio.test/api/induction/file?companyId=${a._id}&version=${moduleA.version}`))).status).toBe(409)
  expect((await file(new Request(`https://talio.test/api/induction/file?version=${moduleB.version}`))).status).toBe(200)
  expect((await database.get('inductionprogresses', progressId(employee, moduleA.version))).acknowledgedAt).toBeTruthy()
})

test('withdrawing one company module leaves the organisation and other companies untouched', async () => {
  const a = await database.create('companies', { _id: oid(), isActive: true, name: 'Company A' })
  const global = await publish()
  const moduleA = await publishInduction(auth, { companyId: String(a._id), title: 'A orientation', source, previewConfirmed: true })
  await database.mutate('employees', employee, current => ({ ...current, company: a._id }))
  expect((await settings(request({ action: 'withdraw', companyId: String(a._id), previousVersion: global.version }))).status).toBe(409)
  expect((await settings(request({ action: 'withdraw', companyId: String(a._id), previousVersion: moduleA.version }))).status).toBe(200)
  expect((await inductionStatus(auth)).required).toBe(false)
  expect((await database.get('inductionprograms', 'organisation')).active).toBe(true)
})
