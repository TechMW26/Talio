import mongoose from 'mongoose'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { getTenantModels } from '@/lib/tenantModels'
import { getTenantConnection } from '@/lib/tenantDb'
import { getAuthAndModels } from '@/lib/auth'
import { getImage, getImageInfo } from '@/lib/gridfs'
import { inspectInductionFile, publishInduction, inductionStatus, updateInductionProgress, progressId, inductionSettings } from '@/lib/hrms/induction.server'
import { POST as settings } from '@/app/api/induction/settings/route'
import { GET as file } from '@/app/api/induction/file/route'
import { GET, POST } from '@/app/api/induction/route'

jest.mock('@/lib/tenantDb', () => ({ getTenantConnection: jest.fn() }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/gridfs', () => ({ getImage: jest.fn(), getImageInfo: jest.fn() }))
jest.mock('@/lib/platform/blobStorage.server', () => ({ buildTenantRootPrefix: id => `tenants/${id}`, buildTenantBlobPrefix: ({ tenantId, ownerId }) => `tenants/${tenantId}/documents/${ownerId}`, getTenantBlob: jest.fn() }))
let server, connection, models, auth, bytes, employee, source
const request = input => new Request('https://talio.test/api/induction', { method: 'POST', body: JSON.stringify(input) })
const publish = previousVersion => publishInduction(auth, { title: 'Company orientation', source, previousVersion, previewConfirmed: true })
beforeAll(async () => {
  server = await MongoMemoryServer.create()
  connection = await mongoose.createConnection(server.getUri()).asPromise()
  getTenantConnection.mockResolvedValue(connection)
  models = await getTenantModels('induction-tests', ['Employee', 'User', 'InductionProgram', 'InductionProgress', 'Company'])
  const pdf = await PDFDocument.create(); pdf.addPage().drawText('Welcome'); pdf.addPage().drawText('Acknowledgement')
  bytes = Buffer.from(await pdf.save())
}, 120000)
afterAll(async () => { await connection?.close(); await server?.stop() })
beforeEach(async () => {
  await Promise.all(Object.values(models).map(model => model.deleteMany({})))
  employee = new mongoose.Types.ObjectId()
  const userId = new mongoose.Types.ObjectId()
  await models.Employee.collection.insertOne({ _id: employee, firstName: 'Induction', lastName: 'Tester' })
  await models.User.collection.insertOne({ _id: userId, employeeId: employee })
  auth = { success: true, user: { _id: userId, role: 'hr' }, models, tenant: { databaseName: 'induction-tests' } }
  source = { fileId: String(new mongoose.Types.ObjectId()), fileName: 'orientation.pdf' }
  getAuthAndModels.mockResolvedValue(auth)
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
  expect((await models.Employee.findById(employee).lean()).inductionCompletion.version).toBe(version)
  expect(await models.InductionProgress.countDocuments()).toBe(1)
})

test('publishing a new version requires acknowledgement again and preserves prior history', async () => {
  const { version } = await publish()
  await updateInductionProgress(auth, { version, action: 'page', page: 1 })
  await updateInductionProgress(auth, { version, action: 'page', page: 2 })
  await updateInductionProgress(auth, { version, action: 'acknowledge', acknowledged: true })
  const replacement = await publish(version)
  expect(replacement.version).not.toBe(version)
  expect((await inductionStatus(auth)).required).toBe(true)
  expect((await models.InductionProgress.findById(progressId(employee, version))).acknowledgedAt).toBeTruthy()
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
  getImageInfo.mockResolvedValue({ length: 100, metadata: { category: 'documents', userId: String(new mongoose.Types.ObjectId()) } })
  await expect(publish()).rejects.toThrow('own account')
})

test('legacy employee-to-user links still require induction', async () => {
  await publish()
  await models.User.updateOne({ _id: auth.user._id }, { $unset: { employeeId: 1 } })
  await models.Employee.collection.updateOne({ _id: employee }, { $set: { userId: auth.user._id } })
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
  const a = await models.Company.create({ name: 'Company A', code: 'A' })
  const b = await models.Company.create({ name: 'Company B', code: 'B' })
  const global = await publish()
  const moduleA = await publishInduction(auth, { companyId: String(a._id), title: 'A orientation', source, previewConfirmed: true })
  const catalog = await inductionSettings(auth, String(a._id))
  expect(catalog.companies).toHaveLength(2)
  expect(catalog.program.version).toBe(moduleA.version)
  expect(catalog.defaultProgram.version).toBe(global.version)
  expect(catalog.companies.find(item => item.id === String(b._id)).program).toBeNull()
  await expect(publishInduction(auth, { companyId: String(new mongoose.Types.ObjectId()), title: 'Outside', source, previewConfirmed: true })).rejects.toMatchObject({ status: 404 })
  auth.user.role = 'employee'
  await expect(inductionSettings(auth)).rejects.toMatchObject({ status: 403 })
})

test('employees receive only their assigned company module, including after transfers', async () => {
  const a = await models.Company.create({ name: 'Company A' })
  const b = await models.Company.create({ name: 'Company B' })
  const global = await publish()
  const moduleA = await publishInduction(auth, { companyId: String(a._id), title: 'A orientation', source, previewConfirmed: true })
  const moduleB = await publishInduction(auth, { companyId: String(b._id), title: 'B orientation', source, previewConfirmed: true })
  expect((await inductionStatus(auth)).program.version).toBe(global.version)
  await models.Employee.updateOne({ _id: employee }, { $set: { company: a._id } })
  expect((await inductionStatus(auth)).program.version).toBe(moduleA.version)
  await updateInductionProgress(auth, { version: moduleA.version, action: 'page', page: 1 })
  await updateInductionProgress(auth, { version: moduleA.version, action: 'page', page: 2 })
  await updateInductionProgress(auth, { version: moduleA.version, action: 'acknowledge', acknowledged: true })
  expect((await inductionStatus(auth)).required).toBe(false)
  await models.Employee.updateOne({ _id: employee }, { $set: { company: b._id } })
  expect((await inductionStatus(auth)).required).toBe(true)
  await expect(updateInductionProgress(auth, { companyId: String(a._id), version: moduleA.version, action: 'page', page: 1 })).rejects.toMatchObject({ status: 409 })
  expect((await file(new Request(`https://talio.test/api/induction/file?companyId=${a._id}&version=${moduleA.version}`))).status).toBe(409)
  expect((await file(new Request(`https://talio.test/api/induction/file?version=${moduleB.version}`))).status).toBe(200)
  expect((await models.InductionProgress.findById(progressId(employee, moduleA.version))).acknowledgedAt).toBeTruthy()
})

test('withdrawing one company module leaves the organisation and other companies untouched', async () => {
  const a = await models.Company.create({ name: 'Company A' })
  const global = await publish()
  const moduleA = await publishInduction(auth, { companyId: String(a._id), title: 'A orientation', source, previewConfirmed: true })
  await models.Employee.updateOne({ _id: employee }, { $set: { company: a._id } })
  expect((await settings(request({ action: 'withdraw', companyId: String(a._id), previousVersion: global.version }))).status).toBe(409)
  expect((await settings(request({ action: 'withdraw', companyId: String(a._id), previousVersion: moduleA.version }))).status).toBe(200)
  expect((await inductionStatus(auth)).required).toBe(false)
  expect((await models.InductionProgram.findById('organisation')).active).toBe(true)
})
