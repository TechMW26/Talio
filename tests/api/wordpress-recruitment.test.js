import { randomBytes } from 'node:crypto'
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { createFirestoreMediaRepository, getFirestoreMediaRepository } from '@/lib/platform/firestoreMedia.server'
import { uploadTenantBlob, getTenantBlob, deleteTenantBlob } from '@/lib/platform/blobStorage.server'
import { getTenantBySlug } from '@/lib/tenantContext'
import { verifyTokenFromRequest } from '@/lib/auth'
import { WP_MODELS, digest, importWordpressJob, importWordpressApplication, wordpressFeed, wordpressAuth, normalizeSiteUrl } from '@/lib/recruitment/wordpress.server'
import { prepareResume, receiveResumeChunk, completeResume, readCandidateResume, RESUME_CHUNK_SIZE } from '@/lib/recruitment/wordpressResume.server'
import { GET as settingsGet, POST as settingsPost } from '@/app/api/recruitment/wordpress/route'
import { POST as syncPost } from '@/app/api/integrations/wordpress/[tenantSlug]/route'

jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreMedia.server', () => ({ ...jest.requireActual('@/lib/platform/firestoreMedia.server'), getFirestoreMediaRepository: jest.fn() }))
jest.mock('@/lib/tenantContext', () => ({ getTenantBySlug: jest.fn() }))
jest.mock('@/lib/auth', () => ({ verifyTokenFromRequest: jest.fn() }))
jest.mock('@/lib/mediaStorage', () => ({ getImage: jest.fn(), getImageInfo: jest.fn() }))
jest.mock('@/lib/platform/blobStorage.server', () => ({ ...jest.requireActual('@/lib/platform/blobStorage.server'), uploadTenantBlob: jest.fn(), getTenantBlob: jest.fn(), deleteTenantBlob: jest.fn() }))
let firestore, store, auth, token
const newId = () => randomBytes(12).toString('hex')
const request = input => new Request('https://talio.test/api/recruitment/wordpress', { method: 'POST', body: JSON.stringify(input) })
const machineRequest = (body, value = token, site = 'https://careers.test') => new Request('https://talio.test/api/integrations/wordpress/test', { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${value}`, 'X-Talio-Site': site }, ...(body && { body: JSON.stringify(body) }) })
const jobInput = (overrides = {}) => ({ externalId: '1', title: 'Engineer', description: 'Build good software', status: 'open', ...overrides })
const applicant = (job, overrides = {}) => ({ externalId: '100', jobId: job.id, fullName: 'Test Person', email: 'candidate@example.test', stage: 'applied', ...overrides })

const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
emulator('Firestore WordPress recruitment', () => {
beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
  firestore = new Firestore({ projectId: 'demo-talio-firestore' })
})
afterAll(async () => { await firestore?.terminate() })
beforeEach(async () => {
  const dataset = `test-wordpress-${Date.now()}-${randomBytes(3).toString('hex')}`, databaseName = 'talio_company_wordpress'
  store = createFirestoreDatabase({ firestore, dataset, databaseName })
  getFirestoreTenantDatabase.mockImplementation(async (name, config = {}) => {
    if (name !== databaseName) throw new Error('Wrong tenant')
    return createFirestoreDatabase({ firestore, dataset, databaseName, ...config })
  })
  const blobs = new Map()
  uploadTenantBlob.mockImplementation(async value => {
    const pathname = `tenants/${value.tenantId}/${value.category}/${value.ownerId}/${value.id || newId()}-${value.filename}`
    blobs.set(pathname, value.body); return { provider: 'vercel-blob', access: value.access, pathname }
  })
  getTenantBlob.mockImplementation(async pathname => blobs.has(pathname) ? ({ statusCode: 200, headers: new Headers(), blob: { size: blobs.get(pathname).length }, stream: new ReadableStream({ start(controller) { controller.enqueue(blobs.get(pathname)); controller.close() } }) }) : null)
  deleteTenantBlob.mockImplementation(async pathname => blobs.delete(pathname))
  getFirestoreMediaRepository.mockResolvedValue(createFirestoreMediaRepository({ firestore, dataset, databaseName, uploadBlob: uploadTenantBlob, readBlob: getTenantBlob, deleteBlob: deleteTenantBlob }))
  const department = newId()
  await store.create('departments', { _id: department, name: 'Engineering' })
  auth = { success: true, user: { role: 'hr', _id: newId() }, tenant: { databaseName, companySlug: 'test' } }
  verifyTokenFromRequest.mockResolvedValue(auth); getTenantBySlug.mockResolvedValue(auth.tenant)
  const response = await settingsPost(request({ action: 'connect', siteUrl: 'https://careers.test/', defaultDepartment: String(department) }))
  expect(response.status).toBe(200)
  token = (await response.json()).data.token
  auth.integration = await store.get('wordpressrecruitmentintegrations', 'wordpress')
})

test('connection credentials are one-time, site-bound, revocable and role-protected', async () => {
  const settings = await (await settingsGet(machineRequest())).json()
  expect(settings.data).not.toHaveProperty('token'); expect(settings.data).not.toHaveProperty('tokenHash')
  await expect(wordpressAuth(machineRequest(), 'test')).resolves.toHaveProperty('tenant.databaseName', 'talio_company_wordpress')
  await expect(wordpressAuth(machineRequest(null, 'invalid'), 'test')).rejects.toMatchObject({ status: 401 })
  await expect(wordpressAuth(machineRequest(null, token, 'https://other.test'), 'test')).rejects.toMatchObject({ status: 403 })
  await expect(wordpressAuth(machineRequest(), '../test')).rejects.toMatchObject({ status: 401 })
  await settingsPost(request({ action: 'disable' }))
  await expect(wordpressAuth(machineRequest(), 'test')).rejects.toMatchObject({ status: 401 })
  auth.user.role = 'employee'
  expect((await settingsGet(machineRequest())).status).toBe(403)
})

test('imports job once, retries without duplicating and rejects conflicting edits', async () => {
  const first = await importWordpressJob(auth, jobInput())
  expect((await importWordpressJob(auth, jobInput())).id).toBe(first.id)
  expect(await store.count('jobpostings')).toBe(1)
  const stored = await store.get('jobpostings', first.id)
  expect(String(stored.department)).toBe(String(auth.integration.defaultDepartment))
  const changed = await importWordpressJob(auth, jobInput({ id: first.id, baseRevision: first.revision, title: 'Senior Engineer' }))
  expect(changed.title).toBe('Senior Engineer')
  await expect(importWordpressJob(auth, jobInput({ id: first.id, title: 'Stale edit', baseRevision: first.revision }))).rejects.toMatchObject({ status: 409 })
  await expect(importWordpressJob(auth, jobInput({ id: first.id, externalId: '2', baseRevision: changed.revision }))).rejects.toMatchObject({ status: 409 })
})

test('applications deduplicate within the job, not across jobs, and preserve mononyms and history', async () => {
  const job = await importWordpressJob(auth, jobInput())
  const first = await importWordpressApplication(auth, applicant(job, { fullName: 'Pinky' }))
  expect(first.fullName).toBe('Pinky')
  expect((await importWordpressApplication(auth, applicant(job, { fullName: 'Pinky' }))).id).toBe(first.id)
  const secondJob = await importWordpressJob(auth, jobInput({ externalId: '2' }))
  await importWordpressApplication(auth, applicant(secondJob, { externalId: '101' }))
  expect(await store.count('candidates')).toBe(2)
  const changed = await importWordpressApplication(auth, applicant(job, { id: first.id, baseRevision: first.revision, stage: 'screening' }))
  expect(changed.stage).toBe('screening')
  expect((await store.get('candidates', first.id)).stageHistory).toHaveLength(2)
})

test('native application matching preserves its existing screening decision', async () => {
  const job = await importWordpressJob(auth, jobInput())
  const candidate = await store.create('candidates', { _id: newId(), createdAt: new Date(), updatedAt: new Date(), firstName: 'Native', lastName: 'Person', email: 'candidate@example.test', jobPosting: job.id, stage: 'shortlisted' })
  const result = await importWordpressApplication(auth, applicant(job))
  expect(result.id).toBe(String(candidate._id)); expect(result.stage).toBe('shortlisted')
  expect(result.fullName).toBe('Native Person')
})

test('feed paginates tied timestamps and never exposes internal salary or interview notes', async () => {
  const at = new Date('2026-01-01T00:00:00Z')
  await Promise.all(Array.from({ length: 27 }, (_, i) => store.create('jobpostings', { _id: newId(), jobTitle: `Role ${i}`, jobDescription: 'Public', status: 'draft', updatedAt: at, salaryRange: { min: 999 }, hiringManager: 'private' })))
  const first = await wordpressFeed(auth, { kind: 'jobs' })
  const second = await wordpressFeed(auth, { kind: 'jobs', cursor: first.cursor })
  expect(first.records).toHaveLength(25); expect(second.records).toHaveLength(2)
  expect(new Set([...first.records, ...second.records].map(item => item.id)).size).toBe(27)
  expect(first.records[0]).not.toHaveProperty('salaryRange'); expect(first.records[0]).not.toHaveProperty('hiringManager')
  await expect(wordpressFeed(auth, { kind: 'jobs', cursor: 'bad' })).rejects.toThrow('cursor')
})

test('private resume transfer resumes, verifies hashes, downloads and completes idempotently', async () => {
  const job = await importWordpressJob(auth, jobInput())
  const candidate = await importWordpressApplication(auth, applicant(job, { hasResume: true }))
  const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(RESUME_CHUNK_SIZE + 16, 32)])
  const upload = await prepareResume(auth, { candidateId: candidate.id, name: 'resume.pdf', size: bytes.length, sha256: digest(bytes) })
  await expect(completeResume(auth, upload)).rejects.toMatchObject({ status: 409 })
  for (let index = 0; index < upload.chunks; index++) {
    const part = { uploadId: upload.uploadId, index, data: bytes.subarray(index * upload.chunkSize, (index + 1) * upload.chunkSize).toString('base64') }
    await receiveResumeChunk(auth, part); await receiveResumeChunk(auth, part)
  }
  const result = await completeResume(auth, upload)
  expect((await completeResume(auth, upload)).revision).toBe(result.revision)
  expect((await readCandidateResume(auth, candidate.id)).bytes.equals(bytes)).toBe(true)
  expect((await store.get('candidates', candidate.id)).wordpress.resumePending).toBe(false)
  await expect(receiveResumeChunk(auth, { uploadId: upload.uploadId, index: 0, data: Buffer.alloc(upload.chunkSize).toString('base64') })).rejects.toMatchObject({ status: 409 })
  await expect(prepareResume({ ...auth, integration: { connectionId: 'different' } }, { candidateId: candidate.id })).rejects.toMatchObject({ status: 403 })
})

test('rejects unsafe website URLs, oversized requests and invalid file types', async () => {
  for (const value of ['http://site.test', 'https://user:pass@site.test', 'https://site.test?key=value']) expect(() => normalizeSiteUrl(value)).toThrow()
  expect((await syncPost(machineRequest({ action: 'job', description: 'a'.repeat(1024 * 1024) }), { params: { tenantSlug: 'test' } })).status).toBe(413)
  const job = await importWordpressJob(auth, jobInput())
  const candidate = await importWordpressApplication(auth, applicant(job))
  await expect(prepareResume(auth, { candidateId: candidate.id, name: 'resume.exe', size: 10, sha256: 'a'.repeat(64) })).rejects.toThrow('PDF')
})

test('rotating tokens preserves pairing identity and invalidates the old token', async () => {
  const id = auth.integration.connectionId
  const response = await settingsPost(request({ action: 'connect', siteUrl: 'https://careers.test', defaultDepartment: String(auth.integration.defaultDepartment) }))
  const nextToken = (await response.json()).data.token
  expect(nextToken).not.toBe(token)
  await expect(wordpressAuth(machineRequest(), 'test')).rejects.toMatchObject({ status: 401 })
  await expect(wordpressAuth(machineRequest(null, nextToken), 'test')).resolves.toHaveProperty('integration.connectionId', id)
  expect((await settingsPost(request({ action: 'connect', siteUrl: 'https://another.test', defaultDepartment: String(auth.integration.defaultDepartment) }))).status).toBe(409)
})

test('a native resume replacement during upload is never overwritten', async () => {
  const job = await importWordpressJob(auth, jobInput())
  const candidate = await importWordpressApplication(auth, applicant(job))
  const bytes = Buffer.from('%PDF-test content')
  const upload = await prepareResume(auth, { candidateId: candidate.id, name: 'resume.pdf', size: bytes.length, sha256: digest(bytes) })
  await receiveResumeChunk(auth, { uploadId: upload.uploadId, index: 0, data: bytes.toString('base64') })
  await store.mutate('candidates', candidate.id, current => ({ ...current, resume: { name: 'newer.pdf', url: '/api/files/newer.pdf' } }))
  await expect(completeResume(auth, upload)).rejects.toMatchObject({ status: 409 })
  expect((await store.get('candidates', candidate.id)).resume.name).toBe('newer.pdf')
})

test('machine API validates payloads and refuses unavailable tenant connections', async () => {
  expect((await syncPost(machineRequest({ action: 'unknown' }), { params: { tenantSlug: 'test' } })).status).toBe(400)
  const response = await syncPost(machineRequest({ action: 'job', ...jobInput() }), { params: { tenantSlug: 'test' } })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  getTenantBySlug.mockResolvedValue(null)
  expect((await syncPost(machineRequest({ action: 'checkpoint' }), { params: { tenantSlug: 'missing' } })).status).toBe(401)
})
})
