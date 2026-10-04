import { randomBytes, createHash } from 'node:crypto'
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { createFirestoreMediaRepository } from '@/lib/platform/firestoreMedia.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getFirestoreMediaRepository } from '@/lib/platform/firestoreMedia.server'
import { uploadTenantBlob, getTenantBlob, deleteTenantBlob } from '@/lib/platform/blobStorage.server'
import { prepareResume, receiveResumeChunk, completeResume, readCandidateResume, RESUME_CHUNK_SIZE } from '@/lib/recruitment/wordpressResume.server'

jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreMedia.server', () => ({ ...jest.requireActual('@/lib/platform/firestoreMedia.server'), getFirestoreMediaRepository: jest.fn() }))
jest.mock('@/lib/platform/blobStorage.server', () => ({
  ...jest.requireActual('@/lib/platform/blobStorage.server'), uploadTenantBlob: jest.fn(), getTenantBlob: jest.fn(), deleteTenantBlob: jest.fn(),
}))
jest.mock('@/lib/recruitment/wordpress.server', () => ({
  digest: value => require('node:crypto').createHash('sha256').update(value).digest('hex'),
  syncError: (message, status = 400) => Object.assign(new Error(message), { status }),
  serializeApplication: value => value,
}))

const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
jest.setTimeout(30000)
const digest = value => createHash('sha256').update(value).digest('hex')
emulator('Native Firestore resumable private media', () => {
  let firestore, store, auth, candidateId, blobs, repository
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  afterAll(async () => firestore.terminate())
  beforeEach(async () => {
    jest.clearAllMocks()
    const databaseName = 'talio_company_resume', dataset = `test-resume-${Date.now()}-${randomBytes(3).toString('hex')}`
    store = createFirestoreDatabase({ firestore, dataset, databaseName })
    blobs = new Map()
    uploadTenantBlob.mockImplementation(async value => {
      const pathname = `tenants/${value.tenantId}/${value.category}/${value.ownerId}/${value.id || randomBytes(6).toString('hex')}-${value.filename}`
      blobs.set(pathname, value.body)
      return { provider: 'vercel-blob', access: value.access, pathname }
    })
    getTenantBlob.mockImplementation(async pathname => blobs.has(pathname) ? ({ statusCode: 200, headers: new Headers(), blob: { size: blobs.get(pathname).length }, stream: new ReadableStream({ start(controller) { controller.enqueue(blobs.get(pathname)); controller.close() } }) }) : null)
    deleteTenantBlob.mockImplementation(async pathname => blobs.delete(pathname))
    repository = createFirestoreMediaRepository({ firestore, dataset, databaseName, uploadBlob: uploadTenantBlob, readBlob: getTenantBlob, deleteBlob: deleteTenantBlob })
    getFirestoreTenantDatabase.mockImplementation(async name => { if (name !== databaseName) throw new Error('Wrong tenant'); return store })
    getFirestoreMediaRepository.mockImplementation(async name => { if (name !== databaseName) throw new Error('Wrong tenant'); return repository })
    candidateId = randomBytes(12).toString('hex')
    await store.create('candidates', { _id: candidateId, updatedAt: new Date(), wordpress: { connectionId: 'wordpress-test', resumePending: true } })
    auth = { success: true, tenant: { databaseName }, integration: { connectionId: 'wordpress-test' } }
  })
  test('private chunks, integrity verification, final Blob and idempotent completion', async () => {
    const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(RESUME_CHUNK_SIZE + 12, 32)])
    const upload = await prepareResume(auth, { candidateId, name: 'resume.pdf', size: bytes.length, sha256: digest(bytes) })
    await expect(completeResume(auth, upload)).rejects.toMatchObject({ status: 409 })
    for (let index = 0; index < upload.chunks; index++) {
      const input = { ...upload, index, data: bytes.subarray(index * upload.chunkSize, (index + 1) * upload.chunkSize).toString('base64') }
      await receiveResumeChunk(auth, input)
      await receiveResumeChunk(auth, input)
    }
    const result = await completeResume(auth, upload)
    expect((await completeResume(auth, upload)).wordpress.resumeFileId).toBe(result.wordpress.resumeFileId)
    expect((await readCandidateResume(auth, candidateId)).bytes).toEqual(bytes)
    expect(blobs.size).toBe(1)
    expect(uploadTenantBlob.mock.calls.every(([arg]) => arg.access === 'private')).toBe(true)
  })
  test('conflicting chunk data and connection ownership fail closed', async () => {
    const bytes = Buffer.from('%PDF-1.7 test')
    const upload = await prepareResume(auth, { candidateId, name: 'resume.pdf', size: bytes.length, sha256: digest(bytes) })
    await receiveResumeChunk(auth, { ...upload, index: 0, data: bytes.toString('base64') })
    await expect(receiveResumeChunk(auth, { ...upload, index: 0, data: Buffer.alloc(bytes.length).toString('base64') })).rejects.toMatchObject({ status: 409 })
    await expect(completeResume({ ...auth, integration: { connectionId: 'other' } }, upload)).rejects.toMatchObject({ status: 403 })
  })
  test('a newer application resume is never overwritten', async () => {
    const bytes = Buffer.from('%PDF-test')
    const upload = await prepareResume(auth, { candidateId, name: 'resume.pdf', size: bytes.length, sha256: digest(bytes) })
    await receiveResumeChunk(auth, { ...upload, index: 0, data: bytes.toString('base64') })
    await store.mutate('candidates', candidateId, current => ({ ...current, resume: { name: 'newer.pdf', url: '/api/files/newer.pdf' } }))
    await expect(completeResume(auth, upload)).rejects.toMatchObject({ status: 409 })
    expect((await store.get('candidates', candidateId)).resume.name).toBe('newer.pdf')
  })
  test('wrong signatures, altered Blob bytes and file types cannot finalize', async () => {
    await expect(prepareResume(auth, { candidateId, name: 'resume.exe', size: 10, sha256: 'a'.repeat(64) })).rejects.toThrow('PDF')
    const bytes = Buffer.from('not-a-pdf')
    const upload = await prepareResume(auth, { candidateId, name: 'resume.pdf', size: bytes.length, sha256: digest(bytes) })
    await receiveResumeChunk(auth, { ...upload, index: 0, data: bytes.toString('base64') })
    await expect(completeResume(auth, upload)).rejects.toThrow('file type')
    for (const path of blobs.keys()) blobs.set(path, Buffer.from('altered'))
    await expect(completeResume(auth, upload)).rejects.toThrow('corrupted')
  })
})
