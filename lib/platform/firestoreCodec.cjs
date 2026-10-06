'use strict'

// Application values only: no database driver or BSON dependency. Fields that
// exceed Firestore's depth/size/type limits are stored in checked Firestore parts,
// not silently omitted. IDs are strings at the repository boundary.
const { createHash } = require('node:crypto')
const { gzipSync, gunzipSync } = require('node:zlib')

const PART_BYTES = 480000
const MAX_PAYLOAD_BYTES = 24 * 1024 * 1024
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

function pack(value) {
  if (value === undefined) return ['undefined']
  if (value === null) return ['null']
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new TypeError('Invalid date')
    return ['date', value.toISOString()]
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return ['bytes', Buffer.from(value).toString('base64')]
  if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)]
  if (typeof value === 'bigint') return ['bigint', String(value)]
  if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value]
  if (Array.isArray(value)) return ['array', value.map(pack)]
  if (value && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return ['object', Object.keys(value).sort().map(key => [key, pack(value[key])])]
  }
  throw new TypeError('Unsupported application value; convert it explicitly before storage')
}

function unpack(value) {
  const [type, data] = value
  switch (type) {
    case 'undefined': return undefined
    case 'null': return null
    case 'date': return new Date(data)
    case 'bytes': return Buffer.from(data, 'base64')
    case 'number': return Number(data)
    case 'bigint': return BigInt(data)
    case 'string': case 'boolean': return data
    case 'array': return data.map(unpack)
    case 'object': return Object.fromEntries(data.map(([key, child]) => [key, unpack(child)]))
    default: throw new Error('Unknown application value encoding')
  }
}

function nativeValue(value) {
  if (value && typeof value.toDate === 'function') return value.toDate()
  if (value instanceof Date || Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (Array.isArray(value)) return value.map(nativeValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, nativeValue(item)]))
  return value
}

function canInline(value, depth = 0, inArray = false, state = { entries: 0 }) {
  if (++state.entries > 2500 || depth > 15 || value === undefined || typeof value === 'bigint') return false
  if (Object.is(value, -0)) return false // Firestore normalizes negative zero.
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value) || value instanceof Date || Buffer.isBuffer(value)) return true
  if (Array.isArray(value)) return !inArray && value.every(item => canInline(item, depth + 1, true, state))
  if (value && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return Object.entries(value).every(([key, child]) => !/^__.*__$/.test(key) && canInline(child, depth + 1, false, state))
  }
  return false
}

function encodeApplicationRecord(record) {
  if (!record || ![Object.prototype, null].includes(Object.getPrototypeOf(record))) throw new TypeError('A plain application record is required')
  const data = Object.create(null), overflow = [], parts = []
  let inlineBudget = 0, totalBytes = 0
  // Small scalar/query fields first. Large bodies never evict IDs or status fields.
  const fields = Object.entries(record).map(([field, value]) => ({ field, value, bytes: Buffer.from(JSON.stringify(pack(value))) })).sort((a, b) => a.bytes.length - b.bytes.length)
  for (const { field, value, bytes } of fields) {
    totalBytes += bytes.length
    if (totalBytes > MAX_PAYLOAD_BYTES) throw new Error('Application record is too large; store media in Vercel Blob')
    const state = { entries: 0 }
    if (!/^__.*__$/.test(field) && canInline(value, 0, false, state) && inlineBudget + bytes.length + state.entries * 64 < 480000) {
      data[field] = value
      inlineBudget += bytes.length + state.entries * 64
      continue
    }
    const compressed = gzipSync(bytes)
    const key = sha256(Buffer.from(field))
    const descriptor = { field, key, length: bytes.length, compressedLength: compressed.length, sha256: sha256(bytes), parts: Math.ceil(compressed.length / PART_BYTES) }
    overflow.push(descriptor)
    for (let offset = 0, index = 0; offset < compressed.length; offset += PART_BYTES, index++) {
      parts.push({ id: `${key}-${index}`, value: { bytes: compressed.subarray(offset, offset + PART_BYTES) } })
    }
  }
  const encodedBytes = parts.reduce((sum, part) => sum + part.value.bytes.length, 0)
  // Leave headroom for the document and deletes within Firestore's 10 MiB transaction.
  if (encodedBytes > 7 * 1024 * 1024 || parts.length > 100) throw new Error('Application record exceeds atomic write budget; extract media first')
  return { envelope: { version: 1, data, overflow }, parts }
}

function partIds(envelope) {
  return (envelope.overflow || []).flatMap(item => Array.from({ length: item.parts }, (_, index) => `${item.key}-${index}`))
}

function decodeApplicationRecord(envelope, parts = new Map()) {
  if (envelope?.version !== 1 || !envelope.data || !Array.isArray(envelope.overflow)) throw new Error('Unsupported application record version')
  const record = nativeValue(envelope.data)
  for (const descriptor of envelope.overflow) {
    if (!Number.isInteger(descriptor.parts) || descriptor.parts < 1 || descriptor.parts > 100 || descriptor.length > MAX_PAYLOAD_BYTES || descriptor.length < 1 || descriptor.key !== sha256(Buffer.from(descriptor.field))) throw new Error('Invalid application record parts')
    const buffers = Array.from({ length: descriptor.parts }, (_, index) => {
      const part = parts.get(`${descriptor.key}-${index}`)
      if (!part || !Buffer.isBuffer(part.bytes) && !(part.bytes instanceof Uint8Array)) throw new Error('Missing application record part')
      return Buffer.from(part.bytes)
    })
    const compressed = Buffer.concat(buffers)
    if (compressed.length !== descriptor.compressedLength) throw new Error('Application record part length mismatch')
    const bytes = gunzipSync(compressed, { maxOutputLength: MAX_PAYLOAD_BYTES })
    if (bytes.length !== descriptor.length || sha256(bytes) !== descriptor.sha256) throw new Error('Application record checksum mismatch')
    Object.defineProperty(record, descriptor.field, { value: unpack(JSON.parse(bytes.toString('utf8'))), enumerable: true, configurable: true, writable: true })
  }
  return record
}

function recordDigest(record) { return sha256(Buffer.from(JSON.stringify(pack(record)))) }

function applicationRecordKey(id) {
  if (typeof id !== 'string' || !id.length || id.length > 512 || /[\x00-\x1f/\\]/.test(id) || id.includes('..')) throw new TypeError('Invalid record ID')
  return /^[a-f0-9]{24}$/.test(id) ? id : `s_${sha256(Buffer.from(id))}`
}

module.exports = { encodeApplicationRecord, decodeApplicationRecord, partIds, recordDigest, applicationRecordKey, nativeValue, pack, unpack }
