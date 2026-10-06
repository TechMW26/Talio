import { createHash } from 'node:crypto'
import { TransformStream } from 'node:stream/web'
import { assertDatabaseName } from './databaseName'

const segment = value => Buffer.from(value).toString('base64url')
const digest = value => createHash('sha256').update(value).digest('hex')
const FILTERS = new Set(['==', '!=', '<', '<=', '>', '>=', 'in', 'not-in', 'array-contains', 'array-contains-any'])

function fieldPath(field) {
  if (typeof field !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(field) || field.split('.').some(part => /^__.*__$/.test(part))) {
    throw new TypeError('Invalid record field')
  }
  return `data.${field}`
}

function nativeValue(value) {
  if (value && typeof value.toDate === 'function') return value.toDate()
  if (Buffer.isBuffer(value) || value instanceof Date) return value
  if (Array.isArray(value)) return value.map(nativeValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, nativeValue(child)]))
  return value
}

function recordData(snapshot) {
  if (!snapshot.exists) return null
  const value = snapshot.data()
  if (value.projection !== 'native-v1-objectids-as-strings' || !value.data) {
    const error = new Error('This preserved record needs an explicit Firestore schema before application use')
    error.code = 'FIRESTORE_SCHEMA_REQUIRED'
    throw error
  }
  return nativeValue(value.data)
}

/**
 * Read-only local migration acceptance boundary, not a production cutover.
 * `auth` MUST be supplied by the server's verified authentication helper, never
 * from a request body/header or an arbitrary caller-selected database name.
 * Each instance is permanently bound to one authenticated tenant. Module-level
 * authorization (HR/document ownership/etc.) remains the API caller's duty.
 */
export function createMigratedTenantReader({ firestore, run, auth, getBlob }) {
  if (!auth?.success || !auth.user || !auth.tenant?.databaseName) throw new Error('Verified tenant authentication is required')
  const databaseName = assertDatabaseName(auth.tenant.databaseName, { tenant: true })
  if (!/^talio_company_[A-Za-z0-9_-]+$/.test(databaseName)) throw new Error('Only registered tenant database paths are accepted')
  if (!/^[a-z0-9][a-z0-9-]{7,79}$/.test(run || '')) throw new Error('Invalid migration run')
  const base = firestore.collection('migrationRuns').doc(run).collection('databases').doc(segment(databaseName))
  function collection(name) {
    if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/.test(name) || name.endsWith('.chunks')) throw new TypeError('Invalid application collection')
    return base.collection('collections').doc(segment(name)).collection('records')
  }
  function objectIdRef(name, id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) throw new TypeError('Invalid source ObjectId')
    return collection(name).doc(digest(JSON.stringify({ $oid: id.toLowerCase() })))
  }
  return Object.freeze({
    async getByObjectId(name, id) {
      return recordData(await objectIdRef(name, id).get())
    },
    async list(name, { filters = [], orderBy = [], limit = 50 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Page limit must be between 1 and 100')
      if (filters.length > 10 || orderBy.length > 3) throw new TypeError('Query is too complex')
      let query = collection(name)
      for (const { field, operator, value } of filters) {
        if (!FILTERS.has(operator)) throw new TypeError('Unsupported Firestore filter')
        query = query.where(fieldPath(field), operator, value)
      }
      for (const { field, direction = 'asc' } of orderBy) {
        if (!['asc', 'desc'].includes(direction)) throw new TypeError('Invalid sort direction')
        query = query.orderBy(fieldPath(field), direction)
      }
      const result = await query.limit(limit).get()
      return result.docs.map(recordData)
    },
    async getMediaDescriptor(bucket, id) {
      if (!['images', 'screenshots', 'recruitmentResumes', 'meetingAudio'].includes(bucket)) throw new TypeError('Unsupported media bucket')
      const snapshot = await objectIdRef(`${bucket}.files`, id).get()
      if (!snapshot.exists) return null
      const value = snapshot.data(), media = value.media
      const expected = `migrations/talio-hrms/${run}/media/${segment(databaseName)}/${segment(bucket)}/${snapshot.id}`
      if (!media || media.provider !== 'vercel-blob' || media.access !== 'private' || media.pathname !== expected || media.database !== databaseName || media.bucket !== bucket) {
        throw new Error('Migrated media is missing or outside the authenticated tenant')
      }
      return { ...media, metadata: recordData(snapshot)?.metadata || {} }
    },
    async openMedia(bucket, id) {
      if (typeof getBlob !== 'function') throw new Error('A private Blob reader is required')
      const media = await this.getMediaDescriptor(bucket, id)
      if (!media) return null
      const result = await getBlob(media.pathname, { access: 'private' })
      if (!result || result.statusCode !== 200) throw new Error('Migrated Blob is unavailable')
      // CDN compression may omit Content-Length; the Blob SDK reports size=0
      // in that case. Verify decoded bytes instead of treating zero as file size.
      const lengthHeader = result.headers?.get('content-length')
      if (!result.headers?.get('content-encoding') && lengthHeader !== null && lengthHeader !== undefined && Number(lengthHeader) !== media.length) {
        await result.stream.cancel()
        throw new Error('Migrated Blob length mismatch')
      }
      let bytes = 0
      const hash = createHash('sha256')
      const stream = result.stream.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          bytes += chunk.byteLength; hash.update(chunk)
          if (bytes > media.length) throw new Error('Migrated Blob length mismatch')
          controller.enqueue(chunk)
        },
        flush() {
          if (bytes !== media.length || hash.digest('hex') !== media.sha256) throw new Error('Migrated Blob checksum mismatch')
        },
      }))
      return { stream, contentType: media.contentType, length: media.length, sha256: media.sha256 }
    },
  })
}
