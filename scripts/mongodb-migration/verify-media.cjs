#!/usr/bin/env node
'use strict'

// Read-only media acceptance. Bytes remain in the existing private Blob store:
// no put/delete/list operations, no copied media, and no private values in logs.
const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const { createHash } = require('node:crypto')
const { materializeRecord, sha256, assertTarget } = require('./core.cjs')
const { loadIndexedEntries, sourceCollectionsHash, mediaDispositionBinding, dispositionRecord, loadNativeDisposition } = require('./migrate.cjs')
const { decodeApplicationRecord } = require('../../lib/platform/firestoreCodec.cjs')
const hash = value => createHash('sha256').update(value).digest('hex')
const checksum = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null
const byteLength = value => Number.isSafeInteger(value) && value >= 0 ? value : null

function blobPath(value) {
  if (typeof value !== 'string') return null
  let candidate = value
  if (/^https:\/\//.test(candidate)) {
    let parsed
    try { parsed = new URL(candidate) } catch { return null }
    if (parsed.hostname.endsWith('.blob.vercel-storage.com')) {
      try { candidate = decodeURIComponent(parsed.pathname.slice(1)) } catch { return null }
    } else if (parsed.pathname.startsWith('/api/files/')) candidate = parsed.pathname
    else return null
  }
  if (candidate.startsWith('/api/files/')) {
    try { candidate = decodeURIComponent(candidate.slice('/api/files/'.length)) } catch { return null }
  }
  if (!/^(tenants\/|migrations\/talio-hrms\/)/.test(candidate)) return null
  if (candidate.includes('..') || /[\x00-\x1f\\?#]/.test(candidate)) throw new Error('INVALID_BLOB_REFERENCE')
  return candidate
}

function collectMediaPlan(entries, datasets, { nativeDisposition } = {}) {
  entries.assertUnchanged?.()
  const disposition = mediaDispositionBinding(nativeDisposition)
  if (!Array.isArray(datasets) || !datasets.length || datasets.some(dataset => !/^[a-z][a-z0-9-]{7,79}$/.test(dataset))) throw new Error('EXPLICIT_DATASET_ALLOWLIST_REQUIRED')
  if (datasets.some(dataset => !entries.get(`talioDatasets/${dataset}`)?.exists)) throw new Error('SELECTED_DATASET_CATALOG_MISSING')
  const selected = new Set(datasets), objects = new Map()
  const report = { recordsScanned: 0, references: 0, repositoryDescriptors: 0, tombstonedRepositoryRecords: 0, embeddedBinaryRecords: 0, embeddedBinaryValues: 0, embeddedBinaryBytes: 0, externalMediaReferencesNotVerified: 0, invalidReferences: 0, conflictingDescriptors: 0 }
  const problems = []
  function problem(recordKey, code) {
    report.invalidReferences++
    if (problems.length < 100) problems.push({ keyHash: hash(recordKey), code })
  }
  function add(value, metadata, { recordKey, required = true, immutable = false }) {
    let pathname
    try { pathname = blobPath(value) } catch { problem(recordKey, 'INVALID_BLOB_REFERENCE'); return }
    if (!pathname) return
    report.references++
    const expectedChecksum = checksum(metadata.sha256 || metadata.checksum)
    const expectedBytes = byteLength(metadata.length ?? metadata.byteLength ?? metadata.fileSize ?? metadata.size)
    const previous = objects.get(pathname)
    if (previous) {
      if (expectedChecksum && previous.sha256 && expectedChecksum !== previous.sha256 || expectedBytes !== null && previous.length !== null && expectedBytes !== previous.length) {
        report.conflictingDescriptors++
        if (problems.length < 100) problems.push({ keyHash: hash(pathname), code: 'CONFLICTING_BLOB_DESCRIPTOR' })
      }
      previous.sha256 ||= expectedChecksum
      if (previous.length === null) previous.length = expectedBytes
      previous.required ||= required
      previous.immutable ||= immutable
    } else objects.set(pathname, { pathname, keyHash: hash(pathname), sha256: expectedChecksum, length: expectedBytes, required, immutable })
  }
  function walk(value, options, depth = 0) {
    if (depth > 100) throw new Error('MEDIA_REFERENCE_DEPTH_EXCEEDED')
    if (!value || Buffer.isBuffer(value) || value instanceof Uint8Array || value instanceof Date) return
    if (Array.isArray(value)) { for (const item of value) walk(item, options, depth + 1); return }
    if (typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string') {
        add(child, value, options)
        let privatePath = null
        try { privatePath = blobPath(child) } catch { continue }
        if (/^https?:\/\//.test(child) && !privatePath && (/file|image|avatar|attachment|document|resume|photo|audio|video|certificate/i.test(key) || /\.(png|jpe?g|webp|gif|pdf|docx?|xlsx?|pptx?|mp[34]|wav)(\?|$)/i.test(child))) report.externalMediaReferencesNotVerified++
      }
      else walk(child, options, depth + 1)
    }
  }
  function embedded(value, depth = 0) {
    if (depth > 100) throw new Error('MEDIA_REFERENCE_DEPTH_EXCEEDED')
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) { report.embeddedBinaryValues++; report.embeddedBinaryBytes += value.byteLength; return true }
    if (!value || typeof value !== 'object' || value instanceof Date) return false
    let found = false
    for (const child of Object.values(value)) found = embedded(child, depth + 1) || found
    return found
  }
  function repositoryDescriptor(descriptor, document, record, options, immutable) {
    const bucket = document.collectionName.slice(0, -6)
    let owned = false
    if (typeof descriptor?.pathname === 'string') {
      if (immutable) {
        const run = /^migrations\/talio-hrms\/([a-z0-9-]+)\//.exec(descriptor.pathname)?.[1]
        const segment = value => Buffer.from(value).toString('base64url')
        owned = Boolean(run) && descriptor.pathname === `migrations/talio-hrms/${run}/media/${segment(document.databaseName)}/${segment(bucket)}/${hash(JSON.stringify({ $oid: document.recordKey }))}`
      } else owned = descriptor.pathname.startsWith(`tenants/${document.databaseName}/${bucket}/${document.dataset}/`) && !descriptor.pathname.includes('..')
    }
    if (!descriptor || descriptor.provider !== 'vercel-blob' || descriptor.access !== 'private' || descriptor.database !== document.databaseName || descriptor.bucket !== bucket || (!immutable && descriptor.length !== record.length) || !checksum(descriptor.sha256) || !Number.isSafeInteger(descriptor.length) || descriptor.length < 1 || !/^[a-f0-9]{24}$/.test(document.recordKey) || !owned) problem(options.recordKey, 'INVALID_REPOSITORY_MEDIA_DESCRIPTOR')
    if (descriptor) walk(descriptor, options)
  }
  for (const entry of entries.values()) {
    const match = /^talioDatasets\/([^/]+)\/databases\/[^/]+\/collections\/[^/]+\/records\/[^/]+$/.exec(entry.path)
    if (!match || !selected.has(match[1])) continue
    const document = dispositionRecord(materializeRecord(entry, entries, match[1]), nativeDisposition)
    if (!document) continue
    report.recordsScanned++
    const record = decodeApplicationRecord(document.envelope, new Map(document.parts.map(part => [part.id, part.value])))
    const tombstone = Boolean(document.envelope.mediaState)
    const options = { recordKey: entry.path, required: !tombstone, immutable: false }
    if (document.collectionName.endsWith('.files')) {
      report.repositoryDescriptors++
      if (tombstone) report.tombstonedRepositoryRecords++
      if (record.storage) repositoryDescriptor(record.storage, document, record, options, record.storage.pathname === document.envelope.media?.pathname)
      if (document.envelope.media) repositoryDescriptor(document.envelope.media, document, record, { ...options, required: true, immutable: true }, true)
      if (!record.storage && !document.envelope.media && !(disposition && tombstone)) problem(entry.path, 'MISSING_REPOSITORY_MEDIA_DESCRIPTOR')
    }
    if (embedded(record)) report.embeddedBinaryRecords++
    walk(record, options)
  }
  const required = [...objects.values()].filter(object => object.required).sort((a, b) => a.keyHash.localeCompare(b.keyHash))
  const referenceHash = createHash('sha256')
  for (const object of [...objects.values()].sort((a, b) => a.keyHash.localeCompare(b.keyHash))) referenceHash.update(JSON.stringify([object.keyHash, object.sha256, object.length, object.required, object.immutable]) + '\n')
  entries.assertUnchanged?.()
  nativeDisposition?.assertComplete()
  if (disposition) report.mediaDisposition = disposition
  return {
    objects: required,
    report: { ...report, uniqueObjects: objects.size, requiredObjects: required.length, deletedObjectsNotRequired: objects.size - required.length, immutableObjects: required.filter(object => object.immutable).length, objectsWithoutSourceChecksum: required.filter(object => !object.sha256).length, objectsWithoutSourceLength: required.filter(object => object.length === null).length, knownRequiredBytes: required.reduce((sum, object) => sum + (object.length || 0), 0), referenceHash: referenceHash.digest('hex'), descriptorProblems: problems, descriptorPlanPassed: report.invalidReferences === 0 && report.conflictingDescriptors === 0 },
  }
}

async function verifyMediaObjects(plan, { readBlob, maximumBytes, concurrency = 2, onProgress, progressIntervalMs = 5000 } = {}) {
  if (typeof readBlob !== 'function' || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('EXPLICIT_BOUNDED_MEDIA_VERIFICATION_REQUIRED')
  if (onProgress !== undefined && typeof onProgress !== 'function' || !Number.isSafeInteger(progressIntervalMs) || progressIntervalMs < 1000 || progressIntervalMs > 60000) throw new Error('BOUNDED_MEDIA_PROGRESS_REQUIRED')
  if (plan.report.knownRequiredBytes > maximumBytes) throw new Error('MEDIA_VERIFICATION_BYTE_BUDGET_EXCEEDED')
  const report = { ...plan.report, complete: false, passed: false, objectsRead: 0, objectsAvailable: 0, checksumsVerified: 0, lengthsVerified: 0, bytesRead: 0, failedObjects: 0, failures: [], writes: 0 }
  let next = 0, budgetExceeded = false
  const started = Date.now()
  let lastProgress = started
  function progress(force = false) {
    const now = Date.now()
    if (!onProgress || !force && now - lastProgress < progressIntervalMs) return
    lastProgress = now
    // An explicit scalar allowlist keeps private paths, provider errors and
    // record bodies out of progress even if verification metadata grows.
    onProgress({ objectsPlanned: plan.objects.length, objectsStarted: report.objectsRead, objectsCompleted: report.objectsAvailable + report.failedObjects, objectsAvailable: report.objectsAvailable, failedObjects: report.failedObjects, bytesRead: report.bytesRead, elapsedMs: Math.max(0, now - started) })
  }
  progress(true)
  const verifiedHash = createHash('sha256'), hashes = []
  await Promise.all(Array.from({ length: Math.min(concurrency, plan.objects.length) }, async () => {
    while (next < plan.objects.length && !budgetExceeded) {
      const object = plan.objects[next++]
      report.objectsRead++
      let reader
      try {
        const response = await readBlob(object.pathname, { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(30000) })
        if (!response?.stream || response.statusCode !== 200) throw new Error('BLOB_OBJECT_UNAVAILABLE')
        reader = response.stream.getReader()
        const actualHash = createHash('sha256')
        let received = 0
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          received += value.byteLength; report.bytesRead += value.byteLength
          if (report.bytesRead > maximumBytes) { budgetExceeded = true; throw new Error('MEDIA_VERIFICATION_BYTE_BUDGET_EXCEEDED') }
          if (object.length !== null && received > object.length) throw new Error('BLOB_LENGTH_MISMATCH')
          actualHash.update(value)
        }
        const actualChecksum = actualHash.digest('hex')
        if (object.length !== null && received !== object.length) throw new Error('BLOB_LENGTH_MISMATCH')
        if (object.sha256 && actualChecksum !== object.sha256) throw new Error('BLOB_CHECKSUM_MISMATCH')
        report.objectsAvailable++
        if (object.length !== null) report.lengthsVerified++
        if (object.sha256) report.checksumsVerified++
        hashes.push([object.keyHash, received, actualChecksum])
      } catch (error) {
        report.failedObjects++
        // One sanitized entry per attempted object, bounded by plan.objects.length.
        // A hard preview cap loses the identities needed for later offline recovery.
        report.failures.push({ keyHash: object.keyHash, code: ['BLOB_OBJECT_UNAVAILABLE', 'BLOB_LENGTH_MISMATCH', 'BLOB_CHECKSUM_MISMATCH', 'MEDIA_VERIFICATION_BYTE_BUDGET_EXCEEDED'].includes(error.message) ? error.message : 'BLOB_READ_FAILED' })
      } finally { if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock() } }
      progress()
    }
  }))
  for (const value of hashes.sort((a, b) => a[0].localeCompare(b[0]))) verifiedHash.update(JSON.stringify(value) + '\n')
  report.verifiedObjectsHash = verifiedHash.digest('hex')
  report.complete = !budgetExceeded && report.objectsRead === plan.objects.length
  report.passed = report.complete && report.descriptorPlanPassed && report.failedObjects === 0
  const retainedIntegrity = report.passed && report.objectsWithoutSourceChecksum === 0 && report.objectsWithoutSourceLength === 0 && report.externalMediaReferencesNotVerified === 0
  report.fullSourceIntegrityVerified = retainedIntegrity && !report.mediaDisposition
  if (report.mediaDisposition) report.availableMediaIntegrityVerified = retainedIntegrity
  report.availabilityOnlyObjects = report.objectsAvailable - report.checksumsVerified
  report.omittedFailureKeys = report.failedObjects - report.failures.length
  progress(true)
  return report
}

async function main() {
  const [command, run, ...args] = process.argv.slice(2)
  if (!['plan', 'verify'].includes(command) || !/^[a-z][a-z0-9-]{7,79}$/.test(run || '')) throw new Error('EXPLICIT_MEDIA_VERIFICATION_RUN_REQUIRED')
  const flags = {}
  for (const arg of args) { const match = /^--(datasets|max-bytes|concurrency|host|database|disposition|disposition-sha256|inventory|inventory-sha256|decision)=([^=]+)$/.exec(arg); if (!match || flags[match[1]]) throw new Error('INVALID_MEDIA_VERIFICATION_FLAG'); flags[match[1]] = match[2] }
  if (!flags.datasets) throw new Error('EXPLICIT_DATASET_ALLOWLIST_REQUIRED')
  const root = path.resolve(__dirname, '../..'), directory = path.join(root, '.migration-data', run)
  const manifestBytes = fs.readFileSync(path.join(directory, 'manifest.json'))
  const manifest = JSON.parse(manifestBytes)
  if (!manifest.complete || manifest.run !== run) throw new Error('COMPLETE_SOURCE_EXPORT_REQUIRED')
  let lastArchiveProgress = 0
  const entries = await loadIndexedEntries(directory, manifest, { onProgress: counters => {
    const now = Date.now()
    if (now - lastArchiveProgress >= 5000 || counters.collections === manifest.collections.length) {
      lastArchiveProgress = now
      console.error(JSON.stringify({ event: 'media-archive-index-progress', collectionsRead: counters.collections, collectionsPlanned: manifest.collections.length, archiveEntries: counters.archiveEntries }))
    }
  } })
  let disposition
  try {
    const readEnv = file => fs.existsSync(path.join(root, file)) ? dotenv.parse(fs.readFileSync(path.join(root, file))) : {}
    const env = { ...readEnv('.env'), ...readEnv('.env.local'), ...process.env }
    const hasDisposition = ['disposition', 'disposition-sha256', 'inventory', 'inventory-sha256', 'decision'].some(name => flags[name])
    const target = hasDisposition ? assertTarget(env.MONGODB_URI, env.MONGODB_DATABASE, flags.host, flags.database) : undefined
    disposition = await loadNativeDisposition(entries, manifest, manifestBytes, flags.datasets.split(','), flags, target)
    const plan = collectMediaPlan(entries, flags.datasets.split(','), { nativeDisposition: disposition?.createOverlay() })
    entries.assertUnchanged()
    if (command === 'plan') {
      console.log(JSON.stringify({ command, writes: 0, ...plan.report }, null, 2))
      if (!plan.report.descriptorPlanPassed) process.exitCode = 1
      return
    }
    if (!env.BLOB_READ_WRITE_TOKEN) throw new Error('EXPLICIT_BLOB_READ_CREDENTIAL_REQUIRED')
    const { get } = require('@vercel/blob')
    const result = await verifyMediaObjects(plan, { readBlob: (pathname, options) => get(pathname, { ...options, token: env.BLOB_READ_WRITE_TOKEN }), maximumBytes: Number(flags['max-bytes']), concurrency: Number(flags.concurrency || 2), onProgress: counters => console.error(JSON.stringify({ event: 'media-verification-progress', ...counters })) })
    entries.assertUnchanged()
    const report = { ...result, run, datasets: [...new Set(flags.datasets.split(','))].sort(), candidateManifestHash: sha256(manifestBytes), sourceHash: sourceCollectionsHash(manifest.collections), sourceHashVersion: 'canonical-sorted-collections-v1', verifiedAt: new Date().toISOString() }
    console.log(JSON.stringify({ command, ...report }, null, 2))
    if (!report.passed) process.exitCode = 1
  } finally { disposition?.close(); entries.close() }
}
if (require.main === module) main().catch(() => { console.error(JSON.stringify({ event: 'media-verification-failed', privateDetailsOmitted: true })); process.exitCode = 1 })
module.exports = { blobPath, collectMediaPlan, verifyMediaObjects }
