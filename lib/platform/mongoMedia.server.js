import { createHash, randomBytes } from 'node:crypto'
import { TransformStream } from 'node:stream/web'
import { uploadTenantBlob, getTenantBlob, deleteTenantBlob, buildTenantBlobPrefix, getBlobStreamLength } from './blobStorage.server'
import { encodeMongoRecord, decodeMongoRecord, mongoRecordId } from './mongoStore.server'
import { imageVariantPaths } from './imageVariants.server'
import { getFirestoreApplicationContext } from './firestoreApplication.server'
import { assertMigrationWritesAllowed } from './migrationFence.cjs'

const BUCKETS = new Set(['images', 'screenshots', 'recruitmentResumes', 'meetingAudio'])
const segment = value => Buffer.from(value).toString('base64url')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

export async function getMongoMediaRepository(databaseName) {
  return createMongoMediaRepository(await getFirestoreApplicationContext(databaseName))
}

export async function getMongoMediaStats({ db, dataset, databaseName }, bucket = 'screenshots') {
  if (!BUCKETS.has(bucket) || !db || !/^talio_company_[A-Za-z0-9_-]+$/.test(databaseName || '') || !/^[a-z][a-z0-9-]{7,79}$/.test(dataset || '')) throw new Error('Verified Mongo tenant/dataset is required')
  const [result] = await db.collection('talio_records').aggregate([
    { $match: { dataset, databaseName, collectionName: `${bucket}.files`, 'envelope.mediaState': { $exists: false }, $or: [
      { 'envelope.media.provider': 'vercel-blob', 'envelope.media.access': 'private', 'envelope.media.database': databaseName, 'envelope.media.bucket': bucket },
      { 'envelope.data.storage.provider': 'vercel-blob', 'envelope.data.storage.access': 'private', 'envelope.data.storage.database': databaseName, 'envelope.data.storage.bucket': bucket },
    ] } },
    { $group: { _id: null, fileCount: { $sum: 1 }, totalSizeBytes: { $sum: '$envelope.data.length' } } },
  ]).toArray()
  const { fileCount = 0, totalSizeBytes = 0 } = result || {}
  return { fileCount, totalSizeBytes, totalSizeMB: Math.round(totalSizeBytes / 1048576 * 100) / 100 }
}

// Only metadata changes provider. Existing IDs, private Blob bytes and historical
// immutable backup descriptors remain unchanged throughout the database cutover.
export function createMongoMediaRepository({ db, dataset, databaseName, sourceDatabase = databaseName, authorizeLegacyImage, uploadBlob = uploadTenantBlob, readBlob = getTenantBlob, deleteBlob = deleteTenantBlob }) {
  if (!db || !/^talio_company_[A-Za-z0-9_-]+$/.test(databaseName || '') || !/^[a-z][a-z0-9-]{7,79}$/.test(dataset || '')) throw new Error('Verified Mongo tenant/dataset is required')
  const legacy = sourceDatabase === 'test' && typeof authorizeLegacyImage === 'function'
  if (sourceDatabase !== databaseName && !legacy) throw new Error('Invalid media source database')
  const records = db.collection('talio_records')
  function identity(bucket, id) {
    if (!BUCKETS.has(bucket)) throw new Error('Unsupported media category')
    if (legacy && bucket !== 'images') throw new Error('Only verified legacy images may be read')
    if (!/^[a-f0-9]{24}$/.test(id || '')) throw new TypeError('Invalid media ID')
    return { _id: mongoRecordId(dataset, sourceDatabase, `${bucket}.files`, id), dataset, databaseName: sourceDatabase, collectionName: `${bucket}.files` }
  }
  function descriptor(bucket, id, document) {
    const envelope = document?.envelope
    if (!envelope || envelope.mediaState) return null
    const file = decodeMongoRecord(document)
    const media = file.storage || envelope.media
    if (!media || media.provider !== 'vercel-blob' || media.access !== 'private' || media.database !== sourceDatabase || media.bucket !== bucket || media.length !== file.length || !Number.isSafeInteger(media.length) || media.length < 1 || !/^[a-f0-9]{64}$/.test(media.sha256 || '')) throw new Error('Invalid private media descriptor')
    // Source backups remain immutable even when a later current descriptor is
    // present. Only the descriptor actually being opened inherits that status.
    const preservedSource = Boolean(envelope.media && media.pathname === envelope.media.pathname)
    if (preservedSource) {
      const sourceRun = /^migrations\/talio-hrms\/([a-z0-9-]+)\//.exec(media.pathname)?.[1]
      const sourceId = digest(Buffer.from(JSON.stringify({ $oid: id })))
      const expected = `migrations/talio-hrms/${sourceRun}/media/${segment(sourceDatabase)}/${segment(bucket)}/${sourceId}`
      if (!sourceRun || media.pathname !== expected) throw new Error('Media belongs to another tenant or source record')
    } else {
      const prefix = `${buildTenantBlobPrefix({ tenantId: databaseName, category: bucket, ownerId: dataset })}/`
      if (!media.pathname?.startsWith(prefix) || media.pathname.includes('..')) throw new Error('Media belongs to another tenant/dataset')
    }
    return { file, media, preservedSource }
  }
  const repository = {
    async save(bucket, { bytes, filename, contentType, metadata = {} }) {
      if (legacy) throw new Error('Legacy media is read-only')
      if (!BUCKETS.has(bucket) || !Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 25 * 1024 * 1024) throw new TypeError('A bounded binary media payload is required')
      const id = randomBytes(12).toString('hex')
      assertMigrationWritesAllowed()
      const media = await uploadBlob({ tenantId: databaseName, category: bucket, ownerId: dataset, filename, body: bytes, contentType, access: 'private', id })
      const file = { _id: id, filename, length: bytes.length, uploadDate: new Date(), contentType, metadata, storage: { ...media, database: databaseName, bucket, length: bytes.length, sha256: digest(bytes) } }
      try {
        assertMigrationWritesAllowed()
        await records.insertOne(encodeMongoRecord({ dataset, databaseName, collectionName: `${bucket}.files`, record: file }))
      } catch (error) {
        try {
          // A freeze can begin while the external upload is in flight. Retain
          // its object for later reconciliation rather than delete source data
          // after the fence was raised, even with an injected Blob transport.
          assertMigrationWritesAllowed()
          await deleteBlob(media.pathname)
        } catch {
          console.error('[MongoMedia] Upload retained; private object cleanup requires retry')
        }
        throw error
      }
      return id
    },
    async info(bucket, id) {
      const stored = descriptor(bucket, id, await records.findOne(identity(bucket, id)))
      if (legacy && stored && !await authorizeLegacyImage(stored.file)) return null
      return stored
    },
    async resolve(bucket, id) {
      const stored = await repository.info(bucket, id)
      if (!stored) return null
      return {
        file: stored.file,
        variantIdentity: legacy ? null : { tenantId: databaseName, dataset, id, sha256: stored.media.sha256 },
        open: canRead => openStored(stored, canRead),
        async validateVariant() {
          if (!await repository.info(bucket, id)) {
            assertMigrationWritesAllowed()
            await deleteBlob(imageVariantPaths({ tenantId: databaseName, dataset, id, sha256: stored.media.sha256 }))
          }
        },
      }
    },
    async open(bucket, id, canRead = () => false) { return openStored(await repository.info(bucket, id), canRead) },
    async remove(bucket, id) {
      if (legacy) throw new Error('Legacy media is read-only')
      const filter = identity(bucket, id)
      // Atomically hide the record before deleting bytes. A failed Blob delete
      // keeps a retryable tombstone, never an accessible dangling file URL.
      assertMigrationWritesAllowed()
      const document = await records.findOneAndUpdate({ ...filter, 'envelope.mediaState': { $ne: 'deleted' } }, { $set: { 'envelope.mediaState': 'deleting' } }, { returnDocument: 'before', includeResultMetadata: false })
      if (!document) return false
      const stored = descriptor(bucket, id, { ...document, envelope: { ...document.envelope, mediaState: undefined } })
      if (!stored) return false
      if (bucket === 'images') {
        assertMigrationWritesAllowed()
        await deleteBlob(imageVariantPaths({ tenantId: databaseName, dataset, id, sha256: stored.media.sha256 }))
      }
      if (!stored.preservedSource) {
        assertMigrationWritesAllowed()
        await deleteBlob(stored.media.pathname)
      }
      assertMigrationWritesAllowed()
      await records.updateOne(filter, { $set: { 'envelope.mediaState': 'deleted' } })
      return true
    },
  }
  async function openStored(stored, canRead = () => false) {
    if (!stored || !await canRead(stored.file)) return null
    const { media, file } = stored
    const blob = await readBlob(media.pathname, { access: 'private' })
    if (!blob?.stream || blob.statusCode !== 200) throw new Error('Private media is unavailable')
    const length = getBlobStreamLength(blob)
    if (length !== null && length !== media.length) { await blob.stream.cancel(); throw new Error('Private media length mismatch') }
    let received = 0
    const hash = createHash('sha256')
    const stream = blob.stream.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        received += chunk.byteLength; hash.update(chunk)
        if (received > media.length) throw new Error('Private media length mismatch')
        controller.enqueue(chunk)
      },
      flush() { if (received !== media.length || hash.digest('hex') !== media.sha256) throw new Error('Private media checksum mismatch') },
    }))
    return { stream, file, length: media.length, contentType: file.contentType || file.metadata?.contentType || 'application/octet-stream' }
  }
  return Object.freeze(repository)
}
