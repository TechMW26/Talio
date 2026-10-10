'use strict'

const { createHash } = require('node:crypto')
const { gzipSync, gunzipSync } = require('node:zlib')
const { pack, unpack, nativeValue, decodeApplicationRecord, recordDigest, applicationRecordKey } = require('../../lib/platform/firestoreCodec.cjs')

const sha256 = value => createHash('sha256').update(value).digest('hex')
const canonical = value => JSON.stringify(pack(value))
const mongoRecordId = (dataset, databaseName, collectionName, recordKey) => sha256(JSON.stringify([dataset, databaseName, collectionName, recordKey]))

function protoValue(value) {
  if (value === null || value === undefined || typeof value !== 'object' || Buffer.isBuffer(value) || value instanceof Uint8Array) return value
  // gRPC clients may return protobuf Long objects instead of decimal strings.
  // Their decimal representation retains every bit, unlike Number(value).
  if (value.__isLong__ === true || (value.constructor?.name === 'Long' && typeof value.toString === 'function')) return value.toString()
  if (Array.isArray(value)) return value.map(protoValue)
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, protoValue(child)]))
}

function snapshotEntry(snapshot) {
  const fields = snapshot.exists ? pack(protoValue(snapshot._fieldsProto)) : null
  if (snapshot.exists && !snapshot._fieldsProto) throw new Error('FIRESTORE_PROTO_UNAVAILABLE')
  const applicationPath = /^talioDatasets\/[^/]+(?:\/databases\/[^/]+\/(?:collections\/[^/]+\/records\/[^/]+(?:\/parts\/[^/]+)?|uniqueKeys\/[^/]+))?$/.test(snapshot.ref.path)
  return {
    path: snapshot.ref.path, exists: snapshot.exists, fields,
    sha256: sha256(JSON.stringify(fields)),
    updateTime: snapshot.updateTime ? { seconds: snapshot.updateTime.seconds, nanoseconds: snapshot.updateTime.nanoseconds } : null,
    ...(snapshot.exists && applicationPath ? { application: pack(nativeValue(snapshot.data())) } : {}),
  }
}

function validateEntry(entry) {
  if (!entry || typeof entry.path !== 'string' || entry.path.split('/').length % 2 !== 0 || entry.path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('INVALID_ARCHIVE_PATH')
  if (typeof entry.exists !== 'boolean' || (entry.exists && !entry.fields) || (!entry.exists && entry.fields !== null)) throw new Error('INVALID_ARCHIVE_ENTRY')
  if (sha256(JSON.stringify(entry.fields)) !== entry.sha256) throw new Error('ARCHIVE_CHECKSUM_MISMATCH')
  return entry
}

function archiveDocument(entry, run) {
  validateEntry(entry)
  const bytes = Buffer.from(canonical(entry))
  return { _id: sha256(JSON.stringify([run, entry.path])), run, path: entry.path, exists: entry.exists, sha256: entry.sha256, payloadSha256: sha256(bytes), codec: 'firestore-proto-pack-gzip-v1', bytes: gzipSync(bytes) }
}

function decodeArchiveDocument(document) {
  const bytes = gunzipSync(Buffer.from(document.bytes), { maxOutputLength: 8 * 1024 * 1024 })
  if (document.codec !== 'firestore-proto-pack-gzip-v1' || sha256(bytes) !== document.payloadSha256) throw new Error('ARCHIVE_CHECKSUM_MISMATCH')
  return validateEntry(unpack(JSON.parse(bytes.toString('utf8'))))
}

function materializeRecord(entry, entries, selectedDataset) {
  const match = /^talioDatasets\/([^/]+)\/databases\/([^/]+)\/collections\/([^/]+)\/records\/([^/]+)$/.exec(entry.path)
  if (!entry.exists || !match || match[1] !== selectedDataset) return null
  const [, dataset, databaseName, collectionName, recordKey] = match
  if (!entry.application) throw new Error('APPLICATION_ENVELOPE_MISSING')
  const envelope = unpack(entry.application)
  const parts = []
  for (const descriptor of envelope.overflow || []) {
    for (let index = 0; index < descriptor.parts; index++) {
      const id = `${descriptor.key}-${index}`
      const child = entries.get(`${entry.path}/parts/${id}`)
      if (!child?.exists || !child.application) throw new Error('APPLICATION_PART_MISSING')
      parts.push({ id, value: unpack(child.application) })
    }
  }
  const record = decodeApplicationRecord(envelope, new Map(parts.map(part => [part.id, part.value])))
  if (applicationRecordKey(record._id) !== recordKey) throw new Error('APPLICATION_RECORD_ID_MISMATCH')
  const digest = recordDigest(record)
  // The envelope digest is not trusted: old projection migrations may leave it
  // stale. Verify the actual reconstructed value and store its current digest.
  return { _id: mongoRecordId(dataset, databaseName, collectionName, recordKey), dataset, databaseName, collectionName, recordKey, envelope, parts, digest }
}

function materializeClaim(entry, selectedDataset) {
  const match = /^talioDatasets\/([^/]+)\/databases\/([^/]+)\/uniqueKeys\/([^/]+)$/.exec(entry.path)
  if (!entry.exists || !match || match[1] !== selectedDataset) return null
  if (!entry.application) throw new Error('APPLICATION_CLAIM_MISSING')
  const [, dataset, databaseName, key] = match
  const value = unpack(entry.application)
  if (typeof value.owner !== 'string' || !value.owner.length) throw new Error('APPLICATION_CLAIM_OWNER_MISSING')
  return { _id: sha256(JSON.stringify([dataset, databaseName, key])), dataset, databaseName, owner: value.owner }
}

function materializeCatalog(entry) {
  const match = /^talioDatasets\/([^/]+)$/.exec(entry.path)
  if (!entry.exists || !match) return null
  if (!entry.application) throw new Error('APPLICATION_CATALOG_MISSING')
  const value = unpack(entry.application)
  return { ...value, _id: match[1], sourceApplicationCutover: value.applicationCutover === true, applicationCutover: false, mongoVerified: false }
}

function assertTarget(uri, databaseName, allowedHost, allowedDatabase) {
  let parsed
  try { parsed = new URL(uri) } catch { throw new Error('INVALID_MONGODB_URI') }
  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) || parsed.hostname !== allowedHost || databaseName !== allowedDatabase || !/^[A-Za-z][A-Za-z0-9_-]{0,62}$/.test(databaseName) || ['admin', 'local', 'config'].includes(databaseName)) throw new Error('MONGODB_TARGET_NOT_EXPLICITLY_ALLOWED')
  return { host: parsed.hostname, databaseName }
}

function collectionSummary(entries) {
  const hash = createHash('sha256')
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path))
  for (const entry of sorted) hash.update(canonical(entry) + '\n')
  return { documents: sorted.filter(entry => entry.exists).length, missingParents: sorted.filter(entry => !entry.exists).length, sha256: hash.digest('hex') }
}

function assertSameSource(before, after) {
  if (before.path !== after.path || before.exists !== after.exists || before.sha256 !== after.sha256 || canonical(before.updateTime) !== canonical(after.updateTime)) throw new Error('SOURCE_CHANGED_DURING_MIGRATION')
}

module.exports = { sha256, canonical, mongoRecordId, protoValue, snapshotEntry, validateEntry, archiveDocument, decodeArchiveDocument, materializeRecord, materializeClaim, materializeCatalog, assertTarget, collectionSummary, assertSameSource }
