import { createHash, randomBytes } from 'node:crypto'
import { TransformStream } from 'node:stream/web'
import { getFirestoreApplicationContext } from './firestoreApplication.server'
import { uploadTenantBlob, getTenantBlob, deleteTenantBlob, buildTenantBlobPrefix, getBlobStreamLength } from './blobStorage.server'
import { encodeApplicationRecord, decodeApplicationRecord, applicationRecordKey } from './firestoreCodec.cjs'

const BUCKETS = new Set(['images', 'screenshots', 'recruitmentResumes', 'meetingAudio'])
const segment = value => Buffer.from(value).toString('base64url')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

export function createFirestoreMediaRepository({ firestore, dataset, databaseName, sourceDatabase = databaseName, authorizeLegacyImage, uploadBlob = uploadTenantBlob, readBlob = getTenantBlob, deleteBlob = deleteTenantBlob }) {
  if (!/^talio_company_[A-Za-z0-9_-]+$/.test(databaseName || '') || !/^[a-z][a-z0-9-]{7,79}$/.test(dataset || '')) throw new Error('Verified Firestore tenant/dataset is required')
  const legacy = sourceDatabase === 'test' && typeof authorizeLegacyImage === 'function'
  if (sourceDatabase !== databaseName && !legacy) throw new Error('Invalid media source database')
  const database = firestore.collection('talioDatasets').doc(dataset).collection('databases').doc(sourceDatabase)
  const reference = (bucket, id) => {
    if (!BUCKETS.has(bucket)) throw new Error('Unsupported media category')
    if (legacy && bucket !== 'images') throw new Error('Only verified legacy images may be read')
    if (!/^[a-f0-9]{24}$/.test(id || '')) throw new TypeError('Invalid media ID')
    return database.collection('collections').doc(`${bucket}.files`).collection('records').doc(applicationRecordKey(id))
  }
  function descriptor(bucket, id, envelope) {
    if (!envelope || envelope.mediaState) return null
    const file = decodeApplicationRecord(envelope)
    const media = file.storage || envelope.media
    if (!media || media.provider !== 'vercel-blob' || media.access !== 'private' || media.database !== sourceDatabase || media.bucket !== bucket || media.length !== file.length || !Number.isSafeInteger(media.length) || media.length < 1 || !/^[a-f0-9]{64}$/.test(media.sha256 || '')) throw new Error('Invalid private media descriptor')
    if (envelope.media) {
      // A migrated immutable object is shared with the verified backup. It must
      // never be deleted when a user deletes the application record.
      const sourceRun = /^migrations\/talio-hrms\/([a-z0-9-]+)\//.exec(media.pathname)?.[1]
      const sourceId = digest(Buffer.from(JSON.stringify({ $oid: id })))
      const expected = `migrations/talio-hrms/${sourceRun}/media/${segment(sourceDatabase)}/${segment(bucket)}/${sourceId}`
      if (!sourceRun || media.pathname !== expected) throw new Error('Media belongs to another tenant or source record')
    } else {
      const prefix = `${buildTenantBlobPrefix({ tenantId: databaseName, category: bucket, ownerId: dataset })}/`
      if (!media.pathname?.startsWith(prefix) || media.pathname.includes('..')) throw new Error('Media belongs to another tenant/dataset')
    }
    return { file, media, preservedSource: Boolean(envelope.media) }
  }
  const repository = {
    async save(bucket, { bytes, filename, contentType, metadata = {} }) {
      if (legacy) throw new Error('Legacy media is read-only')
      if (!BUCKETS.has(bucket) || !Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 25 * 1024 * 1024) throw new TypeError('A bounded binary media payload is required')
      const id = randomBytes(12).toString('hex')
      const media = await uploadBlob({ tenantId: databaseName, category: bucket, ownerId: dataset, filename, body: bytes, contentType, access: 'private', id })
      const file = { _id: id, filename, length: bytes.length, uploadDate: new Date(), contentType, metadata, storage: { ...media, database: databaseName, bucket, length: bytes.length, sha256: digest(bytes) } }
      try {
        const { envelope, parts } = encodeApplicationRecord(file)
        if (parts.length) throw new Error('Media metadata is too large')
        await reference(bucket, id).create(envelope)
      } catch (error) {
        await deleteBlob(media.pathname).catch(() => { console.error('[FirestoreMedia] Upload metadata failed; private object cleanup requires retry') })
        throw error
      }
      return id
    },
    async info(bucket, id) {
      const snapshot = await reference(bucket, id).get()
      const stored = snapshot.exists ? descriptor(bucket, id, snapshot.data()) : null
      if (legacy && stored && !await authorizeLegacyImage(stored.file)) return null
      return stored
    },
    async open(bucket, id, canRead = () => false) {
      const stored = await repository.info(bucket, id)
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
        flush() {
          if (received !== media.length || hash.digest('hex') !== media.sha256) throw new Error('Private media checksum mismatch')
        },
      }))
      return { stream, file, length: media.length, contentType: file.contentType || file.metadata?.contentType || 'application/octet-stream' }
    },
    async remove(bucket, id) {
      if (legacy) throw new Error('Legacy media is read-only')
      const ref = reference(bucket, id)
      const stored = await firestore.runTransaction(async tx => {
        const snapshot = await tx.get(ref)
        if (!snapshot.exists || snapshot.get('mediaState') === 'deleted') return null
        const data = snapshot.data()
        // A previous failed deletion may be retried; reads remain denied.
        const value = descriptor(bucket, id, { ...data, mediaState: undefined })
        tx.update(ref, { mediaState: value.preservedSource ? 'deleted' : 'deleting' })
        return value
      })
      if (!stored) return false
      if (!stored.preservedSource) {
        await deleteBlob(stored.media.pathname)
        await ref.update({ mediaState: 'deleted' })
      }
      return true
    },
  }
  return Object.freeze(repository)
}

export async function getFirestoreMediaRepository(databaseName) {
  return createFirestoreMediaRepository(await getFirestoreApplicationContext(databaseName))
}
