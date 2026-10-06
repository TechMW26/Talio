'use strict'

// Lossless staging codec. This is deliberately not a Mongoose/Firestore adapter.
const { createHash } = require('node:crypto')
const { gzipSync, gunzipSync } = require('node:zlib')
// Archive codec only; not a database client or application runtime dependency.
const { BSON } = require('bson')

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const segment = (text) => Buffer.from(String(text)).toString('base64url')
const decodeOptions = { promoteValues: false, promoteBuffers: false }

function recordIdentity(raw) {
  const doc = BSON.deserialize(raw, decodeOptions)
  if (!Object.hasOwn(doc, '_id')) throw new Error('MISSING_RECORD_ID')
  const id = BSON.EJSON.stringify(doc._id, { relaxed: false })
  return { key: sha256(Buffer.from(id)), id }
}

function encodeRecord(raw) {
  const { key, id } = recordIdentity(raw)
  const value = { codec: 'bson-gzip-v1', sourceId: id, sha256: sha256(raw), byteLength: raw.length, bsonGzip: gzipSync(raw) }
  // Query projection is convenience only; source BSON remains authoritative.
  // Avoid unsupported nested arrays, excess depth/index fanout, or oversized writes.
  try {
    let entries = 0
    function project(input, depth = 0, inArray = false) {
      if (++entries > 3000 || depth > 17) throw new Error('projection-complexity')
      if (input === null || typeof input === 'string' || typeof input === 'boolean' || typeof input === 'number' || input instanceof Date) return input
      if (input?._bsontype === 'ObjectId') return input.toHexString()
      if (['Decimal128', 'Long'].includes(input?._bsontype)) return input.toString()
      if (input?._bsontype === 'Binary') return Buffer.from(input.value(true))
      if (Array.isArray(input)) {
        if (inArray) throw new Error('nested-array')
        return input.map(v => project(v, depth + 1, true))
      }
      if (input && Object.getPrototypeOf(input) === Object.prototype) {
        const output = Object.create(null)
        for (const [key, child] of Object.entries(input)) {
          if (/^__.*__$/.test(key)) throw new Error('reserved-field')
          output[key] = project(child, depth + 1)
        }
        return output
      }
      throw new Error('unsupported-projection-type')
    }
    const data = project(BSON.deserialize(raw))
    if (Buffer.byteLength(JSON.stringify(data)) + value.bsonGzip.length + entries * 64 < 700000) {
      value.data = data
      value.projection = 'native-v1-objectids-as-strings'
    } else value.projection = 'archive-only-size-limit'
  } catch { value.projection = 'archive-only-type-or-depth-limit' }
  return {
    key,
    value,
  }
}

function decodeRecord(value) {
  if (value.codec !== 'bson-gzip-v1') throw new Error('UNKNOWN_CODEC')
  const raw = gunzipSync(Buffer.from(value.bsonGzip))
  if (raw.length !== value.byteLength || sha256(raw) !== value.sha256) throw new Error('CHECKSUM_MISMATCH')
  return raw
}

// BSON documents are already length-prefixed. Never split arbitrary binary data on newlines.
async function* readBson(stream) {
  let pending = Buffer.alloc(0)
  for await (const chunk of stream) {
    pending = Buffer.concat([pending, chunk])
    while (pending.length >= 4) {
      const length = pending.readInt32LE(0)
      if (length < 5 || length > 16 * 1024 * 1024) throw new Error('INVALID_BSON_LENGTH')
      if (pending.length < length) break
      yield pending.subarray(0, length)
      pending = pending.subarray(length)
    }
  }
  if (pending.length) throw new Error('TRUNCATED_BSON_ARCHIVE')
}

function assertRunId(run) {
  if (!/^[a-z0-9][a-z0-9-]{7,79}$/.test(run || '')) throw new Error('INVALID_RUN_ID')
  return run
}

function selectDatabases(defaultName, tenantNames, available) {
  // Explicit Talio allowlist; do not copy unrelated applications or Mongo system DBs.
  const names = new Set([defaultName, 'talio_superadmin', ...tenantNames])
  for (const name of available) {
    if (name.startsWith('talio_company_') || name === 'mushroom_world_group') names.add(name)
  }
  for (const name of names) {
    if (!name || ['admin', 'config', 'local'].includes(name)) throw new Error('UNSAFE_SOURCE_DATABASE')
  }
  return [...names].sort()
}

async function mapLimit(values, limit, action) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('INVALID_CONCURRENCY')
  let cursor = 0
  const results = new Array(values.length)
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= values.length) return
      results[index] = await action(values[index], index)
    }
  }))
  const failure = outcomes.find(result => result.status === 'rejected')
  if (failure) throw failure.reason
  return results
}

async function gridfsDigests(chunks) {
  const result = new Map()
  let current = null, hash, length = 0, nextN = 0, valid = true
  function finish() {
    if (current === null) return
    if (result.has(current)) throw new Error('NONCONTIGUOUS_SOURCE_MEDIA')
    result.set(current, { sha256: hash.digest('hex'), length, valid })
  }
  for await (const raw of chunks) {
    const chunk = BSON.deserialize(raw)
    const id = BSON.EJSON.stringify(chunk.files_id, { relaxed: false })
    if (id !== current) {
      finish(); current = id; hash = createHash('sha256'); length = 0; nextN = 0; valid = true
    }
    if (chunk.n !== nextN++) valid = false
    const bytes = Buffer.isBuffer(chunk.data) ? chunk.data : chunk.data.value(true)
    hash.update(bytes); length += bytes.length
  }
  finish()
  return result
}

function canonicalProjection(value) {
  function normalize(input) {
    if (input && typeof input.toDate === 'function') input = input.toDate()
    if (input instanceof Date) return ['date', input.toISOString()]
    if (Buffer.isBuffer(input) || input instanceof Uint8Array) return ['bytes', Buffer.from(input).toString('base64')]
    if (Array.isArray(input)) return ['array', input.map(normalize)]
    if (input && typeof input === 'object') return ['object', Object.keys(input).sort().map(key => [key, normalize(input[key])])]
    if (typeof input === 'number' && !Number.isFinite(input)) return ['number', String(input)]
    return [typeof input, input]
  }
  return JSON.stringify(normalize(value))
}

module.exports = { sha256, segment, encodeRecord, decodeRecord, recordIdentity, readBson, assertRunId, selectDatabases, decodeOptions, mapLimit, gridfsDigests, canonicalProjection }
