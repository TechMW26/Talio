'use strict'

// Read-only transport, not cutover evidence. A complete names snapshot still
// needs exact archived body validation and same-epoch reads for changed bodies.
const PROTOCOL = 'fixed-epoch-kindless-metadata-v1'
const { QualifiedResourcePath } = require('@google-cloud/firestore/build/src/path')

function timestamp(value) {
  if (!value || typeof value !== 'object') throw new Error('EXACT_PROTOBUF_TIMESTAMP_REQUIRED')
  const secondsValue = value.seconds
  const isLong = secondsValue && typeof secondsValue === 'object' && Number.isInteger(secondsValue.low) && Number.isInteger(secondsValue.high) && typeof secondsValue.toString === 'function'
  if (!(typeof secondsValue === 'string' || typeof secondsValue === 'bigint' || (typeof secondsValue === 'number' && Number.isSafeInteger(secondsValue)) || isLong)) throw new Error('EXACT_PROTOBUF_TIMESTAMP_REQUIRED')
  const seconds = String(secondsValue), nanos = value.nanos ?? value.nanoseconds ?? 0
  if (!/^(0|[1-9]\d*)$/.test(seconds) || BigInt(seconds) > 253402300799n || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9 || (value.nanos !== undefined && value.nanoseconds !== undefined && value.nanos !== value.nanoseconds)) throw new Error('EXACT_PROTOBUF_TIMESTAMP_REQUIRED')
  return { seconds, nanos }
}

function compareTimestamp(a, b) {
  const left = timestamp(a), right = timestamp(b)
  return BigInt(left.seconds) < BigInt(right.seconds) ? -1 : BigInt(left.seconds) > BigInt(right.seconds) ? 1 : Math.sign(left.nanos - right.nanos)
}

function parentResource({ sourceProject, sourceDatabase }) {
  if (typeof sourceProject !== 'string' || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(sourceProject) || typeof sourceDatabase !== 'string' || !/^(\(default\)|[a-z][a-z0-9-]{2,62})$/.test(sourceDatabase)) throw new Error('EXPLICIT_SOURCE_SCOPE_REQUIRED')
  return `projects/${sourceProject}/databases/${sourceDatabase}/documents`
}

function documentPath(name, parent) {
  if (typeof name !== 'string' || !name.startsWith(`${parent}/`)) throw new Error('METADATA_DOCUMENT_SCOPE_MISMATCH')
  const relative = name.slice(parent.length + 1), segments = relative.split('/')
  if (segments.length % 2 !== 0 || segments.some(segment => !segment || segment === '.' || segment === '..') || Buffer.byteLength(name) > 6144) throw new Error('METADATA_DOCUMENT_NAME_INVALID')
  return relative
}

function compareDocumentNames(left, right) {
  // Firestore compares resource PATH SEGMENTS, not the slash-joined string.
  // Use the installed SDK's UTF8/numeric-ID ordering to match __name__ cursors.
  // Numeric IDs precede strings and are compared as BigInt, not lexically.
  try { return QualifiedResourcePath.fromSlashSeparatedString(left).compareTo(QualifiedResourcePath.fromSlashSeparatedString(right)) }
  catch { throw new Error('METADATA_DOCUMENT_NAME_INVALID') }
}

function after(left, right) { return compareDocumentNames(left, right) > 0 }

function metadataRequest(options) {
  const parent = parentResource(options), readTime = timestamp(options.readTime)
  const limit = options.limit ?? 1000
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000 || readTime.nanos % 1000 !== 0) throw new Error('BOUNDED_METADATA_PAGE_REQUIRED')
  const structuredQuery = { from: [{ allDescendants: true }], select: { fields: [{ fieldPath: '__name__' }] }, orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: { value: limit } }
  if (options.afterName !== undefined) {
    documentPath(options.afterName, parent)
    // before:false is start AFTER this document; no offset, collection filter,
    // or fresh readTime may silently alter the resumed snapshot.
    structuredQuery.startAt = { values: [{ referenceValue: options.afterName }], before: false }
  }
  return { parent, readTime, structuredQuery }
}

function assertEpochUsable(readTime, nowMs) {
  const value = timestamp(readTime), age = BigInt(Math.trunc(nowMs)) * 1000000n - (BigInt(value.seconds) * 1000000000n + BigInt(value.nanos))
  if (age > 3600000000000n || age < -60000000000n) throw new Error('FIXED_SOURCE_EPOCH_EXPIRED_OR_FUTURE')
}

async function readMetadataPage(client, options) {
  if (!client || typeof client.runQuery !== 'function') throw new Error('READ_ONLY_RUN_QUERY_TRANSPORT_REQUIRED')
  const request = metadataRequest(options), limit = request.structuredQuery.limit.value
  const deadlineMs = options.deadlineMs ?? 30000, now = options.now ?? Date.now
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60000 || typeof now !== 'function') throw new Error('BOUNDED_STREAM_DEADLINE_REQUIRED')
  const signal = options.signal
  if (signal !== undefined && (!signal || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean')) throw new Error('METADATA_ABORT_SIGNAL_REQUIRED')
  if (signal?.aborted) throw new Error('SOURCE_METADATA_QUERY_ABORTED')
  assertEpochUsable(request.readTime, now())
  const rows = [], startedAt = new Date(now()).toISOString()
  let previousName = options.afterName || '', responses = 0
  await new Promise((resolve, reject) => {
    let stream
    try { stream = client.runQuery(request, { timeout: deadlineMs, retry: null }) }
    catch (error) {
      const safe = new Error('SOURCE_METADATA_QUERY_FAILED')
      if (Number.isInteger(error.code)) safe.code = error.code
      reject(safe); return
    }
    let settled = false
    const finish = error => {
      if (settled) return
      settled = true; clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) { stream.cancel?.(); reject(error) } else resolve()
    }
    const abort = () => finish(new Error('SOURCE_METADATA_QUERY_ABORTED'))
    const timer = setTimeout(() => finish(new Error('BOUNDED_METADATA_STREAM_TIMEOUT')), deadlineMs)
    signal?.addEventListener('abort', abort, { once: true })
    stream.on('error', error => {
      const safe = new Error('SOURCE_METADATA_QUERY_FAILED')
      if (Number.isInteger(error.code)) safe.code = error.code
      finish(safe)
    })
    stream.on('data', response => {
      if (settled) return
      try {
        assertEpochUsable(request.readTime, now())
        if (++responses > limit + 2 || !response || !response.readTime || compareTimestamp(response.readTime, request.readTime) !== 0 || (response.skippedResults || 0) !== 0 || (response.transaction && response.transaction.length)) throw new Error('EXACT_METADATA_PAGE_EPOCH_REQUIRED')
        const doc = response.document
        if (!doc) return
        const relativePath = documentPath(doc.name, request.parent)
        if (rows.length >= limit || (previousName && !after(doc.name, previousName)) || Object.keys(doc.fields || {}).length || !doc.updateTime || !doc.createTime) throw new Error('METADATA_PAGE_ORDER_PROJECTION_OR_VERSION_INVALID')
        const updateTime = timestamp(doc.updateTime), createTime = timestamp(doc.createTime)
        if (compareTimestamp(updateTime, request.readTime) > 0 || compareTimestamp(createTime, updateTime) > 0) throw new Error('METADATA_VERSION_OUTSIDE_EPOCH')
        rows.push({ name: doc.name, path: relativePath, updateTime, createTime }); previousName = doc.name
      } catch (error) { finish(error) }
    })
    stream.on('end', () => finish())
    if (signal?.aborted) abort()
  })
  if (!responses) throw new Error('EXACT_METADATA_PAGE_RESPONSE_REQUIRED')
  // An empty page terminates the caller's cursor loop. An exact-limit page is
  // never declared complete: fetch its next page at the SAME epoch to prove EOF.
  return { protocol: PROTOCOL, sourceProject: options.sourceProject, sourceDatabase: options.sourceDatabase, readTime: request.readTime, startedAt, finishedAt: new Date(now()).toISOString(), rows, responses, afterName: previousName || null, done: rows.length < limit, sourceWrites: 0, fullBodiesRead: false, cutoverSafe: false }
}

function ancestorPrefixes(name, scope) {
  const segments = documentPath(name, parentResource(scope)).split('/')
  const collections = [], possibleMissingParents = []
  for (let length = 1; length < segments.length; length += 2) {
    collections.push(segments.slice(0, length).join('/'))
    if (length > 1) possibleMissingParents.push(segments.slice(0, length - 1).join('/'))
  }
  return { collections, possibleMissingParents }
}

module.exports = { PROTOCOL, timestamp, compareTimestamp, compareDocumentNames, metadataRequest, readMetadataPage, ancestorPrefixes }
