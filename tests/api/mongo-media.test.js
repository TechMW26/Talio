import { createHash } from 'node:crypto'
import { createMongoMediaRepository, getMongoMediaStats } from '@/lib/platform/mongoMedia.server'
import { encodeMongoRecord } from '@/lib/platform/mongoStore.server'
import { createFirestoreMediaRepository } from '@/lib/platform/firestoreMedia.server'

const dataset = 'test-mongo-media', databaseName = 'talio_company_media'
const bytes = Buffer.from('private media exact bytes')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
function fixture() {
  const docs = new Map()
  const records = {
    insertOne: jest.fn(async doc => { if (docs.has(doc._id)) throw new Error('duplicate'); docs.set(doc._id, doc) }),
    findOne: jest.fn(async filter => docs.get(filter._id) || null),
    findOneAndUpdate: jest.fn(async filter => {
      const doc = docs.get(filter._id)
      if (!doc || doc.envelope.mediaState === 'deleted') return null
      const before = { ...doc, envelope: { ...doc.envelope } }
      doc.envelope.mediaState = 'deleting'
      return before
    }),
    updateOne: jest.fn(async filter => { docs.get(filter._id).envelope.mediaState = 'deleted' }),
  }
  const db = { collection: jest.fn(() => records) }
  const uploadBlob = jest.fn(async options => ({ provider: 'vercel-blob', access: 'private', pathname: `tenants/${options.tenantId}/${options.category}/${options.ownerId}/${options.id}-file` }))
  const readBlob = jest.fn(async () => ({ statusCode: 200, headers: new Headers(), stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }) }))
  const deleteBlob = jest.fn(async () => {})
  const context = { db, dataset, databaseName, uploadBlob, readBlob, deleteBlob }
  return { docs, records, context, uploadBlob, readBlob, deleteBlob, repository: createMongoMediaRepository(context) }
}

test('private bytes, ownership, stable media IDs and retry-safe tombstones survive Mongo cutover', async () => {
  const { repository, uploadBlob, readBlob, deleteBlob } = fixture()
  const id = await repository.save('meetingAudio', { bytes, filename: 'meeting.webm', contentType: 'audio/webm', metadata: { meetingId: 'meeting' } })
  expect(id).toMatch(/^[a-f0-9]{24}$/)
  expect(uploadBlob.mock.calls[0][0].access).toBe('private')
  expect(await repository.open('meetingAudio', id)).toBeNull()
  expect(readBlob).not.toHaveBeenCalled()
  const result = await repository.open('meetingAudio', id, file => file.metadata.meetingId === 'meeting')
  expect(Buffer.from(await new Response(result.stream).arrayBuffer())).toEqual(bytes)
  deleteBlob.mockRejectedValueOnce(new Error('temporary delete failure'))
  await expect(repository.remove('meetingAudio', id)).rejects.toThrow('temporary delete failure')
  expect(await repository.info('meetingAudio', id)).toBeNull()
  expect(await repository.remove('meetingAudio', id)).toBe(true)
  expect(await repository.remove('meetingAudio', id)).toBe(false)
})

test('metadata resolution uses one read and does not leak foreign tenant files', async () => {
  const { repository, records, context, readBlob } = fixture()
  const id = await repository.save('images', { bytes, filename: 'image', contentType: 'image/png' })
  records.findOne.mockClear()
  const resolved = await repository.resolve('images', id)
  await new Response((await resolved.open(() => true)).stream).arrayBuffer()
  expect(records.findOne).toHaveBeenCalledTimes(1)
  expect(await createMongoMediaRepository({ ...context, databaseName: 'talio_company_other' }).open('images', id, () => true)).toBeNull()
  expect(readBlob).toHaveBeenCalledTimes(1)
})

test('migrated immutable backup Blob is retained while derivatives are removed', async () => {
  const { repository, records, deleteBlob } = fixture()
  const id = '111111111111111111111111', bucket = 'images', sourceKey = digest(Buffer.from(JSON.stringify({ $oid: id })))
  const pathname = `migrations/talio-hrms/source-run/media/${Buffer.from(databaseName).toString('base64url')}/${Buffer.from(bucket).toString('base64url')}/${sourceKey}`
  const media = { database: databaseName, bucket, provider: 'vercel-blob', access: 'private', pathname, length: bytes.length, sha256: digest(bytes) }
  await records.insertOne(encodeMongoRecord({ dataset, databaseName, collectionName: 'images.files', record: { _id: id, length: bytes.length }, envelopeMetadata: { media } }))
  expect(await repository.remove(bucket, id)).toBe(true)
  expect(deleteBlob).toHaveBeenCalledTimes(1)
  expect(deleteBlob.mock.calls[0][0]).toHaveLength(4)
  expect(deleteBlob.mock.calls[0][0]).not.toContain(pathname)
})

test('legacy shared images still require tenant ownership and stay read-only', async () => {
  const { records, context, readBlob } = fixture()
  const id = '222222222222222222222222', sourceDatabase = 'test', bucket = 'images'
  const pathname = `migrations/talio-hrms/source-run/media/${Buffer.from(sourceDatabase).toString('base64url')}/${Buffer.from(bucket).toString('base64url')}/${digest(Buffer.from(JSON.stringify({ $oid: id })))}`
  const media = { database: sourceDatabase, bucket, provider: 'vercel-blob', access: 'private', pathname, length: bytes.length, sha256: digest(bytes) }
  await records.insertOne(encodeMongoRecord({ dataset, databaseName: sourceDatabase, collectionName: 'images.files', record: { _id: id, length: bytes.length, metadata: { userId: 'owner' } }, envelopeMetadata: { media } }))
  const authorizeLegacyImage = jest.fn(async () => false)
  const repository = createMongoMediaRepository({ ...context, sourceDatabase, authorizeLegacyImage })
  expect(await repository.info(bucket, id)).toBeNull()
  expect(readBlob).not.toHaveBeenCalled()
  authorizeLegacyImage.mockResolvedValue(true)
  expect(Buffer.from(await new Response((await repository.open(bucket, id, () => true)).stream).arrayBuffer())).toEqual(bytes)
  await expect(repository.remove(bucket, id)).rejects.toThrow('read-only')
  await expect(repository.save(bucket, { bytes })).rejects.toThrow('read-only')
  await expect(repository.info('screenshots', id)).rejects.toThrow('legacy images')
  expect(() => createMongoMediaRepository({ ...context, sourceDatabase })).toThrow('source database')
})

test('stream checksum validation and failed metadata compensation are preserved', async () => {
  const { repository, readBlob, records, deleteBlob } = fixture()
  const id = await repository.save('images', { bytes, filename: 'image', contentType: 'image/png' })
  const changed = Buffer.alloc(bytes.length, 0)
  readBlob.mockResolvedValueOnce({ statusCode: 200, headers: new Headers(), stream: new ReadableStream({ start(c) { c.enqueue(changed); c.close() } }) })
  await expect(new Response((await repository.open('images', id, () => true)).stream).arrayBuffer()).rejects.toThrow('checksum mismatch')
  records.insertOne.mockRejectedValueOnce(new Error('metadata failure'))
  await expect(repository.save('images', { bytes, filename: 'image' })).rejects.toThrow('metadata failure')
  expect(deleteBlob).toHaveBeenCalledTimes(1)
})

test('compatibility media factory is Mongo-only and rejects Firestore-only contexts', () => {
  const { context } = fixture()
  expect(createFirestoreMediaRepository).toBe(createMongoMediaRepository)
  expect(createFirestoreMediaRepository(context)).toHaveProperty('info')
  expect(() => createFirestoreMediaRepository({ firestore: {}, dataset, databaseName })).toThrow('Verified Mongo')
})

test('a current replacement coexisting with a backup opens and deletes only current bytes', async () => {
  const { repository, docs, records, deleteBlob } = fixture()
  const id = await repository.save('images', { bytes, filename: 'replacement.png', contentType: 'image/png' })
  const document = [...docs.values()][0]
  const currentPath = document.envelope.data.storage.pathname
  const backupPath = `migrations/talio-hrms/source-run/media/${Buffer.from(databaseName).toString('base64url')}/${Buffer.from('images').toString('base64url')}/${digest(Buffer.from(JSON.stringify({ $oid: id })))}`
  document.envelope.media = { database: databaseName, bucket: 'images', provider: 'vercel-blob', access: 'private', pathname: backupPath, length: bytes.length, sha256: digest(bytes) }
  const opened = await repository.open('images', id, () => true)
  expect(Buffer.from(await new Response(opened.stream).arrayBuffer())).toEqual(bytes)
  expect(await repository.remove('images', id)).toBe(true)
  expect(deleteBlob).toHaveBeenCalledWith(currentPath)
  expect(deleteBlob.mock.calls.flat()).not.toContain(backupPath)
  expect(records.updateOne).toHaveBeenCalledTimes(1)
  expect(document.envelope.media.pathname).toBe(backupPath)
})

describe('Mongo media migration write fence', () => {
  let previous
  beforeEach(() => { previous = process.env.TALIO_MIGRATION_FREEZE; delete process.env.TALIO_MIGRATION_FREEZE })
  afterEach(() => {
    if (previous === undefined) delete process.env.TALIO_MIGRATION_FREEZE
    else process.env.TALIO_MIGRATION_FREEZE = previous
    jest.restoreAllMocks()
  })
  test('frozen saves and removes stop before any external or metadata write while reads remain allowed', async () => {
    const { repository, records, uploadBlob, deleteBlob } = fixture()
    const id = await repository.save('images', { bytes, filename: 'existing.png' })
    uploadBlob.mockClear(); records.insertOne.mockClear()
    process.env.TALIO_MIGRATION_FREEZE = '1'
    await expect(repository.save('images', { bytes, filename: 'new.png' })).rejects.toMatchObject({ code: 'MIGRATION_WRITE_FENCE', status: 503 })
    await expect(repository.remove('images', id)).rejects.toMatchObject({ code: 'MIGRATION_WRITE_FENCE' })
    expect(uploadBlob).not.toHaveBeenCalled(); expect(records.insertOne).not.toHaveBeenCalled()
    expect(records.findOneAndUpdate).not.toHaveBeenCalled(); expect(records.updateOne).not.toHaveBeenCalled()
    expect(deleteBlob).not.toHaveBeenCalled()
    expect(await repository.info('images', id)).not.toBeNull()
    expect(Buffer.from(await new Response((await repository.open('images', id, () => true)).stream).arrayBuffer())).toEqual(bytes)
  })
  test('a fence raised during upload blocks insertion and retains the uploaded object for retry', async () => {
    const { repository, records, uploadBlob, deleteBlob } = fixture()
    const original = uploadBlob.getMockImplementation()
    uploadBlob.mockImplementation(async options => { const result = await original(options); process.env.TALIO_MIGRATION_FREEZE = '1'; return result })
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(repository.save('images', { bytes, filename: 'upload.png' })).rejects.toMatchObject({ code: 'MIGRATION_WRITE_FENCE' })
    expect(records.insertOne).not.toHaveBeenCalled(); expect(deleteBlob).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('[MongoMedia] Upload retained; private object cleanup requires retry')
  })
  test('metadata failure compensation retains bytes if the fence was raised during insertion', async () => {
    const { repository, records, deleteBlob } = fixture()
    records.insertOne.mockImplementation(async () => { process.env.TALIO_MIGRATION_FREEZE = '1'; throw new Error('metadata insert failed') })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(repository.save('images', { bytes, filename: 'upload.png' })).rejects.toThrow('metadata insert failed')
    expect(deleteBlob).not.toHaveBeenCalled()
  })
  test('a fence raised after tombstoning retains bytes and a retryable deleting state', async () => {
    const { repository, docs, records, deleteBlob } = fixture()
    const id = await repository.save('images', { bytes, filename: 'image.png' })
    const original = records.findOneAndUpdate.getMockImplementation()
    records.findOneAndUpdate.mockImplementation(async filter => { const result = await original(filter); process.env.TALIO_MIGRATION_FREEZE = '1'; return result })
    await expect(repository.remove('images', id)).rejects.toMatchObject({ code: 'MIGRATION_WRITE_FENCE' })
    expect(deleteBlob).not.toHaveBeenCalled(); expect(records.updateOne).not.toHaveBeenCalled()
    expect([...docs.values()][0].envelope.mediaState).toBe('deleting')
    delete process.env.TALIO_MIGRATION_FREEZE
    records.findOneAndUpdate.mockImplementation(original)
    expect(await repository.remove('images', id)).toBe(true)
  })
  test('a freeze between derivative and original deletion prevents subsequent destructive steps', async () => {
    const { repository, records, deleteBlob } = fixture()
    const id = await repository.save('images', { bytes, filename: 'image.png' })
    deleteBlob.mockImplementation(async () => { process.env.TALIO_MIGRATION_FREEZE = '1' })
    await expect(repository.remove('images', id)).rejects.toMatchObject({ code: 'MIGRATION_WRITE_FENCE' })
    expect(deleteBlob).toHaveBeenCalledTimes(1)
    expect(Array.isArray(deleteBlob.mock.calls[0][0])).toBe(true)
    expect(records.updateOne).not.toHaveBeenCalled()
  })
  test('the final tombstone commit is fenced even if original deletion was already in flight', async () => {
    const { repository, docs, records, deleteBlob } = fixture()
    const id = await repository.save('meetingAudio', { bytes, filename: 'audio.webm' })
    deleteBlob.mockImplementation(async () => { process.env.TALIO_MIGRATION_FREEZE = '1' })
    await expect(repository.remove('meetingAudio', id)).rejects.toMatchObject({ code: 'MIGRATION_WRITE_FENCE' })
    expect(deleteBlob).toHaveBeenCalledTimes(1); expect(records.updateOne).not.toHaveBeenCalled()
    expect([...docs.values()][0].envelope.mediaState).toBe('deleting')
  })
  test('stale derivative cleanup cannot delete objects during the freeze', async () => {
    const { repository, docs, deleteBlob } = fixture()
    const id = await repository.save('images', { bytes, filename: 'image.png' })
    const resolved = await repository.resolve('images', id)
    docs.clear(); process.env.TALIO_MIGRATION_FREEZE = '1'
    await expect(resolved.validateVariant()).rejects.toMatchObject({ code: 'MIGRATION_WRITE_FENCE' })
    expect(deleteBlob).not.toHaveBeenCalled()
  })
  test('read-only statistics count active documents once, retaining backup/current parity and excluding tombstones', async () => {
    const media = length => ({ database: databaseName, bucket: 'screenshots', provider: 'vercel-blob', access: 'private', length })
    const row = (number, length, { backup = false, current = false, state, dbName = databaseName, access = 'private' } = {}) => encodeMongoRecord({
      dataset, databaseName: dbName, collectionName: 'screenshots.files',
      record: { _id: String(number).padStart(24, '0'), length, ...(current && { storage: { ...media(length), access } }) },
      envelopeMetadata: { ...(backup && { media: { ...media(length), access } }), ...(state && { mediaState: state }) },
    })
    const rows = [row(1, 100, { backup: true }), row(2, 200, { current: true }), row(3, 300, { backup: true, current: true }), row(4, 400, { backup: true, state: 'deleted' }), row(5, 500, { current: true, state: 'deleting' }), row(6, 600, { current: true, dbName: 'talio_company_other' }), row(7, 700, { current: true, access: 'public' })]
    const field = (record, name) => name.split('.').reduce((value, key) => value?.[key], record)
    const matches = (record, filter) => Object.entries(filter).every(([key, value]) => key === '$or' ? value.some(item => matches(record, item)) : value && typeof value === 'object' && '$exists' in value ? (field(record, key) !== undefined) === value.$exists : field(record, key) === value)
    const aggregate = jest.fn(pipeline => ({ toArray: async () => {
      const active = rows.filter(record => matches(record, pipeline[0].$match))
      expect(pipeline[1]).toEqual({ $group: { _id: null, fileCount: { $sum: 1 }, totalSizeBytes: { $sum: '$envelope.data.length' } } })
      return [{ fileCount: active.length, totalSizeBytes: active.reduce((sum, record) => sum + record.envelope.data.length, 0) }]
    } }))
    process.env.TALIO_MIGRATION_FREEZE = '1'
    expect(await getMongoMediaStats({ db: { collection: () => ({ aggregate }) }, dataset, databaseName })).toMatchObject({ fileCount: 3, totalSizeBytes: 600 })
    expect(aggregate).toHaveBeenCalledTimes(1)
  })
})
