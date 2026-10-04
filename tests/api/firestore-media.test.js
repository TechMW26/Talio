import { createHash } from 'node:crypto'
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreMediaRepository } from '../../lib/platform/firestoreMedia.server'
import { encodeApplicationRecord } from '../../lib/platform/firestoreCodec.cjs'

jest.setTimeout(30000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip

emulator('Firestore metadata with private Blob media', () => {
  let firestore, dataset, repository, uploadBlob, readBlob, deleteBlob
  const databaseName = 'talio_company_media'
  const bytes = Buffer.from('private audio bytes')
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
    dataset = `test-media-${Date.now()}`
    uploadBlob = jest.fn(async options => ({ provider: 'vercel-blob', access: options.access, pathname: `tenants/${options.tenantId}/${options.category}/${options.ownerId}/${options.id}-audio`, url: 'https://private.example.test/audio' }))
    readBlob = jest.fn(async () => ({ statusCode: 200, headers: new Headers({ 'content-encoding': 'gzip' }), stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }) }))
    deleteBlob = jest.fn(async () => {})
    repository = createFirestoreMediaRepository({ firestore, dataset, databaseName, uploadBlob, readBlob, deleteBlob })
  })
  afterAll(async () => { await firestore?.terminate() })
  beforeEach(() => { jest.clearAllMocks() })
  test('uploads privately, checks meeting ownership, streams exact bytes and deletes only the new object', async () => {
    const id = await repository.save('meetingAudio', { bytes, filename: 'audio', contentType: 'audio/webm', metadata: { meetingId: 'meeting-a' } })
    expect(uploadBlob.mock.calls[0][0].access).toBe('private')
    expect(await repository.open('meetingAudio', id, file => file.metadata.meetingId === 'other')).toBeNull()
    expect(readBlob).not.toHaveBeenCalled()
    const result = await repository.open('meetingAudio', id, file => file.metadata.meetingId === 'meeting-a')
    expect(Buffer.from(await new Response(result.stream).arrayBuffer())).toEqual(bytes)
    expect(await repository.remove('meetingAudio', id)).toBe(true)
    expect(deleteBlob).toHaveBeenCalledTimes(1)
    expect(await repository.info('meetingAudio', id)).toBeNull()
  })
  test('cannot read another tenant or silently open files without an ownership decision', async () => {
    const id = await repository.save('images', { bytes, filename: 'image', contentType: 'image/png' })
    expect(await repository.open('images', id)).toBeNull()
    const foreign = createFirestoreMediaRepository({ firestore, dataset, databaseName: 'talio_company_other', uploadBlob, readBlob, deleteBlob })
    expect(await foreign.open('images', id, () => true)).toBeNull()
    expect(readBlob).not.toHaveBeenCalled()
  })
  test('deleting a migrated file never deletes the verified backup Blob', async () => {
    const id = '111111111111111111111111', run = 'talio-20261003-cloud-02', bucket = 'images'
    const sourceKey = createHash('sha256').update(JSON.stringify({ $oid: id })).digest('hex')
    const pathname = `migrations/talio-hrms/${run}/media/${Buffer.from(databaseName).toString('base64url')}/${Buffer.from(bucket).toString('base64url')}/${sourceKey}`
    const reference = firestore.collection('talioDatasets').doc(dataset).collection('databases').doc(databaseName).collection('collections').doc('images.files').collection('records').doc(id)
    const { envelope } = encodeApplicationRecord({ _id: id, length: bytes.length, contentType: 'image/png', metadata: {} })
    await reference.create({ ...envelope, media: { database: databaseName, bucket, provider: 'vercel-blob', access: 'private', pathname, length: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } })
    expect(await repository.remove(bucket, id)).toBe(true)
    expect(deleteBlob).not.toHaveBeenCalled()
    expect((await reference.get()).get('mediaState')).toBe('deleted')
    expect(await repository.open(bucket, id, () => true)).toBeNull()
  })
  test('refuses altered data and cleans up the Blob if metadata creation fails', async () => {
    const id = await repository.save('images', { bytes, filename: 'image', contentType: 'image/png' })
    readBlob.mockResolvedValueOnce({ statusCode: 200, headers: new Headers(), stream: new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('changed')); controller.close() } }) })
    const result = await repository.open('images', id, () => true)
    await expect(new Response(result.stream).arrayBuffer()).rejects.toThrow('checksum mismatch')
    await expect(repository.save('images', { bytes, filename: 'image', contentType: 'image/png', metadata: { nested: [[1, 2]] } })).rejects.toThrow('metadata is too large')
    expect(deleteBlob).toHaveBeenCalledTimes(1)
  })
  test('legacy shared images require verified tenant ownership and remain read-only', async () => {
    const id = '222222222222222222222222', sourceDatabase = 'test', bucket = 'images', run = 'talio-20261003-cloud-02'
    const sourceKey = createHash('sha256').update(JSON.stringify({ $oid: id })).digest('hex')
    const pathname = `migrations/talio-hrms/${run}/media/${Buffer.from(sourceDatabase).toString('base64url')}/${Buffer.from(bucket).toString('base64url')}/${sourceKey}`
    const reference = firestore.collection('talioDatasets').doc(dataset).collection('databases').doc(sourceDatabase).collection('collections').doc('images.files').collection('records').doc(id)
    const { envelope } = encodeApplicationRecord({ _id: id, length: bytes.length, contentType: 'image/png', metadata: { userId: 'tenant-a-user' } })
    await reference.create({ ...envelope, media: { database: sourceDatabase, bucket, provider: 'vercel-blob', access: 'private', pathname, length: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } })
    const authorizeLegacyImage = jest.fn(async () => false)
    const shared = createFirestoreMediaRepository({ firestore, dataset, databaseName, sourceDatabase, authorizeLegacyImage, readBlob })
    expect(await shared.info(bucket, id)).toBeNull()
    expect(await shared.open(bucket, id, () => true)).toBeNull()
    expect(readBlob).not.toHaveBeenCalled()
    authorizeLegacyImage.mockResolvedValue(true)
    expect(Buffer.from(await new Response((await shared.open(bucket, id, () => true)).stream).arrayBuffer())).toEqual(bytes)
    await expect(shared.remove(bucket, id)).rejects.toThrow('read-only')
    await expect(shared.save(bucket, { bytes })).rejects.toThrow('read-only')
    await expect(shared.info('screenshots', id)).rejects.toThrow('legacy images')
    expect(() => createFirestoreMediaRepository({ firestore, dataset, databaseName, sourceDatabase })).toThrow('source database')
  })
})
