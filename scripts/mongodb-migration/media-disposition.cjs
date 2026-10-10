#!/usr/bin/env node
'use strict'

// Offline reversible disposition only. No database or Blob transport is opened.
// Private before/after records are emitted only to an explicitly new, protected
// ignored output directory. Source archives and their checksums remain intact.
const fs = require('node:fs')
const path = require('node:path')
const { sha256, canonical, materializeRecord } = require('./core.cjs')
const { loadIndexedEntries, sourceCollectionsHash } = require('./migrate.cjs')
const { collectMediaPlan, blobPath } = require('./verify-media.cjs')
const { createMediaRecoveryPlan } = require('./media-recovery-plan.cjs')
const { encodeApplicationRecord, decodeApplicationRecord, pack, unpack, recordDigest } = require('../../lib/platform/firestoreCodec.cjs')
const clone = value => unpack(pack(value))
const DELETE = Symbol('remove-unavailable-media')
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const DECISION = 'remove-unavailable-media-only'
const MAX_LINE_BYTES = 64 * 1024 * 1024
function validTarget(target) { return target && /^[a-z0-9][a-z0-9.-]{1,252}$/.test(target.host || '') && /^[a-zA-Z0-9_-]{1,63}$/.test(target.databaseName || '') && !['admin', 'local', 'config'].includes(target.databaseName) }
const scope = document => `${document.dataset}/${document.databaseName}`
const identity = (document, bucket, id) => `${scope(document)}/${bucket}/${id}`
const mediaContext = value => /(?:screenshots?|captures?|tiles|attachments?|images?|files|documents?|resumes?)$/i.test(value || '')
const screenshotContext = (document, keys) => /^screenshot|^productivity/i.test(document.collectionName) || keys.some(key => /screenshot|capture|tile/i.test(String(key)))

function validateInventory(plan, manifest, inventoryBytes, { datasets, expectedInventoryHash, candidateManifestHash } = {}) {
  if (!Buffer.isBuffer(inventoryBytes) || inventoryBytes.length > 16 * 1024 * 1024 || !isHash(expectedInventoryHash) || sha256(inventoryBytes) !== expectedInventoryHash) throw new Error('EXACT_COMPLETE_MEDIA_INVENTORY_HASH_REQUIRED')
  const inventory = JSON.parse(inventoryBytes)
  if (inventory.command !== 'scoped-blob-media-inventory' || inventory.complete !== true || !isHash(inventory.inventoryHash)) throw new Error('COMPLETE_SCOPED_BLOB_INVENTORY_REQUIRED')
  if (inventory.omittedFailureKeys !== 0 || inventory.failures?.length !== inventory.failedObjects) throw new Error('COMPLETE_MEDIA_FAILURE_IDENTITIES_REQUIRED')
  // Reuse the strict source/dataset/reference/count/identity checks without
  // presenting metadata listing as checksum verification of object content.
  const normalized = Buffer.from(JSON.stringify({ ...inventory, command: 'verify', objectsRead: inventory.requiredObjects }))
  createMediaRecoveryPlan(plan, normalized, { expectedReportHash: sha256(normalized), run: manifest.run, datasets, candidateManifestHash, sourceHash: sourceCollectionsHash(manifest.collections) })
  if (inventory.failures.some(failure => failure.code !== 'BLOB_OBJECT_UNAVAILABLE')) throw new Error('ONLY_CONFIRMED_MISSING_MEDIA_DISPOSITION_SUPPORTED')
  return inventory
}

function *records(entries, datasets, acceptCollection = () => true) {
  const selected = new Set(datasets)
  for (const key of entries.keys()) {
    const match = /^talioDatasets\/([^/]+)\/databases\/[^/]+\/collections\/([^/]+)\/records\/[^/]+$/.exec(key)
    if (!match || !selected.has(match[1]) || !acceptCollection(match[2])) continue
    const entry = entries.get(key)
    const document = materializeRecord(entry, entries, match[1])
    if (document) yield { entry, document, record: decodeApplicationRecord(document.envelope, new Map(document.parts.map(part => [part.id, part.value]))) }
  }
}

function createMediaDisposition(entries, manifest, inventoryBytes, options = {}) {
  entries.assertUnchanged?.()
  if (manifest.complete !== true || !isHash(options.candidateManifestHash) || typeof options.onChange !== 'function') throw new Error('COMPLETE_SOURCE_AND_PROTECTED_CHANGE_SINK_REQUIRED')
  if (options.decision !== DECISION || !validTarget(options.target)) throw new Error('EXPLICIT_MEDIA_DISPOSITION_DECISION_AND_TARGET_REQUIRED')
  const plan = collectMediaPlan(entries, options.datasets)
  const inventory = validateInventory(plan, manifest, inventoryBytes, options)
  const failed = new Set(inventory.failures.map(failure => failure.keyHash))
  const failedPath = value => { const pathname = blobPath(value); return pathname && failed.has(sha256(pathname)) }
  const unavailableFiles = new Set(), restoredFiles = new Map(), unavailableScreenshots = new Set()
  const currentPath = descriptor => descriptor?.pathname && failedPath(descriptor.pathname)
  let repositoryTombstones = 0, restoredRepositoryRecords = 0, removedReferences = 0, removedMediaItems = 0, deletedGalleryRecords = 0, changedRecords = 0

  // Establish bucket- and tenant-scoped native IDs before cleaning indirect API
  // URLs. A coincidentally equal business _id is never treated as a media ID.
  for (const { document, record } of records(entries, options.datasets, name => name.endsWith('.files'))) {
    if (!document.collectionName.endsWith('.files')) continue
    const bucket = document.collectionName.slice(0, -6), current = record.storage || document.envelope.media
    // A previously deleted repository row still requires its immutable archive
    // descriptor. If that archive is confirmed missing, omit the deleted row;
    // optional stale mutable cache references do not prove recoverability.
    if (document.envelope.mediaState) {
      if (currentPath(document.envelope.media)) unavailableFiles.add(identity(document, bucket, document.recordKey))
      continue
    }
    if (!currentPath(current)) continue
    const backup = document.envelope.media
    if (backup && !currentPath(backup) && backup.sha256 === current.sha256 && backup.length === current.length && backup.length === record.length) restoredFiles.set(document._id, clone(backup))
    else unavailableFiles.add(identity(document, bucket, document.recordKey))
  }

  function indirectFailure(value, document, keys) {
    if (typeof value !== 'string') return false
    if (failedPath(value)) return true
    let url
    try { url = new URL(value, 'http://local.invalid') } catch { return false }
    const file = /^\/api\/(images|screenshots)\/([a-f0-9]{24})\/?$/.exec(url.pathname)
    if (file) {
      const bucket = file[1] === 'screenshots' || screenshotContext(document, keys) ? 'screenshots' : 'images'
      return unavailableFiles.has(identity(document, bucket, file[2]))
    }
    if (url.pathname === '/api/activity/screenshot') {
      return unavailableFiles.has(identity(document, 'screenshots', url.searchParams.get('fileId'))) || unavailableScreenshots.has(`${scope(document)}/${url.searchParams.get('id')}`)
    }
    const key = keys.at(-1)
    if (/^[a-f0-9]{24}$/.test(value)) {
      if (['gridfsFileId', 'screenshotFileId'].includes(key) || key === 'fileId' && screenshotContext(document, keys)) return unavailableFiles.has(identity(document, 'screenshots', value))
      if (['imageId', 'imageFileId', 'profilePictureId'].includes(key)) return unavailableFiles.has(identity(document, 'images', value))
      if (['screenshotId'].includes(key)) return unavailableScreenshots.has(`${scope(document)}/${value}`)
    }
    return false
  }
  function hasMedia(value, document, keys = []) {
    if (!value || Buffer.isBuffer(value) || value instanceof Uint8Array || value instanceof Date) return false
    if (typeof value === 'string') {
      if (indirectFailure(value, document, keys)) return false
      return Boolean(blobPath(value)) || /^(https?:\/\/|\/api\/(?:images|screenshots|files)\/|\/api\/activity\/screenshot)/.test(value) && /url|path|image|photo|avatar|screenshot|file|storage/i.test(String(keys.at(-1) || '')) || /^[a-f0-9]{24}$/.test(value) && ['gridfsFileId', 'fileId', 'screenshotFileId', 'imageFileId'].includes(keys.at(-1))
    }
    if (typeof value !== 'object') return false
    return Object.entries(value).some(([key, child]) => hasMedia(child, document, [...keys, key]))
  }

  // Remove media-only gallery rows only if no remaining alternate URL/file is
  // usable. Other collections are retained, including analyses and attendance.
  for (const { document, record } of records(entries, options.datasets, name => ['screenshots', 'screenshotcomposites'].includes(name))) {
    if (!['screenshots', 'screenshotcomposites'].includes(document.collectionName)) continue
    const mainKeys = ['gridfsFileId', 'fileId', 'path', 'url', 'imageUrl', 'imagekitUrl']
    if (mainKeys.some(key => indirectFailure(record[key], document, [key])) && !mainKeys.some(key => hasMedia(record[key], document, [key]))) unavailableScreenshots.add(`${scope(document)}/${record._id}`)
  }

  function clean(value, document, keys = [], inMediaArray = false) {
    if (typeof value === 'string') {
      if (indirectFailure(value, document, keys)) { removedReferences++; return DELETE }
      return value
    }
    if (!value || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value) || value instanceof Uint8Array) return clone(value)
    if (Array.isArray(value)) {
      const result = []
      for (const child of value) {
        const cleaned = clean(child, document, keys, mediaContext(String(keys.at(-1))))
        if (cleaned !== DELETE) result.push(cleaned)
      }
      return result
    }
    if (inMediaArray && screenshotContext(document, keys) && unavailableScreenshots.has(`${scope(document)}/${value.screenshotId || value._id}`)) { removedMediaItems++; return DELETE }
    const result = {}, before = removedReferences
    for (const [key, child] of Object.entries(value)) {
      const cleaned = clean(child, document, [...keys, key])
      if (cleaned !== DELETE) Object.defineProperty(result, key, { value: cleaned, writable: true, enumerable: true, configurable: true })
    }
    if (inMediaArray && removedReferences > before && !hasMedia(result, document, keys)) { removedMediaItems++; return DELETE }
    if (Array.isArray(value.screenshots) && Array.isArray(result.screenshots) && value.screenshots.length !== result.screenshots.length) {
      for (const key of ['screenshotCount', 'screenshotsCount']) if (value[key] === value.screenshots.length) result[key] = result.screenshots.length
    }
    return result
  }

  const operationsHash = require('node:crypto').createHash('sha256')
  for (const { entry, document, record } of records(entries, options.datasets)) {
    let after = null, reason
    const galleryRemoved = ['screenshots', 'screenshotcomposites'].includes(document.collectionName) && unavailableScreenshots.has(`${scope(document)}/${record._id}`)
    const repositoryRemoved = document.collectionName.endsWith('.files') && unavailableFiles.has(identity(document, document.collectionName.slice(0, -6), document.recordKey))
    if (galleryRemoved) { reason = 'remove-unavailable-gallery-record'; deletedGalleryRecords++ }
    else if (repositoryRemoved) { reason = 'remove-unavailable-repository-record'; repositoryTombstones++ }
    else {
      const cleaned = clean(record, document), originalMetadata = Object.fromEntries(Object.entries(document.envelope).filter(([key]) => !['version', 'data', 'overflow'].includes(key))), metadata = clone(originalMetadata)
      if (metadata.media && currentPath(metadata.media)) { delete metadata.media; removedReferences++ }
      if (document.collectionName.endsWith('.files')) {
        const bucket = document.collectionName.slice(0, -6)
        if (restoredFiles.has(document._id)) {
          cleaned.storage = restoredFiles.get(document._id)
          reason = 'retain-owned-available-immutable-backup'; restoredRepositoryRecords++
        }
      }
      if (!reason && recordDigest(cleaned) === recordDigest(record) && canonical(metadata) === canonical(originalMetadata)) continue
      const encoded = encodeApplicationRecord(cleaned)
      const digest = recordDigest(cleaned)
      if (Object.hasOwn(metadata, 'digest')) metadata.digest = digest
      after = { ...document, envelope: { ...metadata, ...encoded.envelope }, parts: encoded.parts, digest }
      reason ||= 'remove-unavailable-media-references'
    }
    // Preserve exact original proto entries and every overflow part, not only
    // the decoded subset. This is a rollback ledger, not a second source archive.
    const sourceEntries = [entry, ...document.parts.map(part => entries.get(`${entry.path}/parts/${part.id}`))]
    const change = { recordKeyHash: sha256(entry.path), reason, beforeHash: sha256(canonical(document)), afterHash: after ? sha256(canonical(after)) : null, before: pack(document), after: after ? pack(after) : null, sourceEntries }
    options.onChange(change)
    operationsHash.update(JSON.stringify([change.recordKeyHash, reason, change.beforeHash, change.afterHash]) + '\n')
    changedRecords++
  }
  entries.assertUnchanged?.()
  return { command: 'offline-media-disposition', schemaVersion: 1, complete: true, run: manifest.run, datasets: [...new Set(options.datasets)].sort(), decision: DECISION, userAuthorization: DECISION, target: { ...options.target }, authorizationRequiredForApply: true, sourceArchiveUnmodified: true, providerReads: 0, sourceWrites: 0, targetWrites: 0, mediaWrites: 0, inventoryReportHash: options.expectedInventoryHash, inventoryHash: inventory.inventoryHash, candidateManifestHash: options.candidateManifestHash, sourceHash: sourceCollectionsHash(manifest.collections), sourceHashVersion: 'canonical-sorted-collections-v1', referenceHash: plan.report.referenceHash, confirmedMissingObjects: failed.size, changedRecords, repositoryTombstones, deletedRepositoryRecords: repositoryTombstones, restoredRepositoryRecords, deletedGalleryRecords, deletedNativeRecords: repositoryTombstones + deletedGalleryRecords, removedReferences, removedMediaItems, operationsHash: operationsHash.digest('hex') }
}

// The ledger is never trusted as an arbitrary patch bank: reconstruct every
// operation from the original source and complete inventory before exposing it.
async function loadDispositionLedger(directory, bindings = {}) {
  bindings.entries?.assertUnchanged?.()
  const sameFile = (actual, original) => actual.dev === original.dev && actual.ino === original.ino && actual.size === original.size && actual.mtimeMs === original.mtimeMs && actual.ctimeMs === original.ctimeMs
  const owned = stat => typeof process.getuid !== 'function' || stat.uid === process.getuid()
  const protectedFile = (name, maximum) => {
    const filename = path.join(directory, name), stat = fs.lstatSync(filename)
    if (!stat.isFile() || !owned(stat) || stat.mode & 0o077 || stat.size > maximum) throw new Error('PROTECTED_DISPOSITION_FILE_REQUIRED')
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    try {
      const opened = fs.fstatSync(fd)
      if (!opened.isFile() || !owned(opened) || opened.mode & 0o077 || !sameFile(opened, stat)) throw new Error('PROTECTED_DISPOSITION_FILE_CHANGED_DURING_OPEN')
      return { filename, stat: opened, fd }
    } catch (error) { fs.closeSync(fd); throw error }
  }
  const dirStat = fs.lstatSync(directory)
  if (!dirStat.isDirectory() || !owned(dirStat) || dirStat.mode & 0o077) throw new Error('PROTECTED_DISPOSITION_DIRECTORY_REQUIRED')
  const reportFile = protectedFile('report.json', 16 * 1024 * 1024)
  let reportBytes
  try {
    reportBytes = fs.readFileSync(reportFile.fd)
    if (!sameFile(fs.fstatSync(reportFile.fd), reportFile.stat) || !sameFile(fs.lstatSync(reportFile.filename), reportFile.stat)) throw new Error('DISPOSITION_REPORT_CHANGED')
  } finally { fs.closeSync(reportFile.fd) }
  if (!isHash(bindings.expectedDispositionHash) || sha256(reportBytes) !== bindings.expectedDispositionHash) throw new Error('EXACT_DISPOSITION_REPORT_HASH_REQUIRED')
  const report = JSON.parse(reportBytes)
  if (!bindings.entries || !bindings.manifest || !Buffer.isBuffer(bindings.inventoryBytes)) throw new Error('ORIGINAL_SOURCE_AND_INVENTORY_REQUIRED')
  if (report.command !== 'offline-media-disposition' || report.complete !== true || report.schemaVersion !== 1 || report.userAuthorization !== DECISION || report.decision !== DECISION || bindings.decision !== DECISION || !validTarget(bindings.target)) throw new Error('VALIDATED_MEDIA_DISPOSITION_REQUIRED')
  for (const key of ['run', 'candidateManifestHash', 'sourceHash', 'inventoryReportHash', 'referenceHash', 'target']) if (canonical(report[key]) !== canonical(bindings[key])) throw new Error('DISPOSITION_SCOPE_BINDING_MISMATCH')
  if (canonical(report.datasets) !== canonical([...new Set(bindings.datasets || [])].sort())) throw new Error('DISPOSITION_DATASET_BINDING_MISMATCH')
  const ledgerFile = protectedFile('changes.ndjson', Number.MAX_SAFE_INTEGER)
  const fd = ledgerFile.fd, index = new Map()
  const hash = require('node:crypto').createHash('sha256')
  let closed = false
  const unchanged = () => {
    if (closed) throw new Error('DISPOSITION_LEDGER_CLOSED')
    const current = fs.fstatSync(fd), named = fs.lstatSync(ledgerFile.filename)
    if (!named.isFile() || !owned(named) || named.mode & 0o077 || !sameFile(current, ledgerFile.stat) || !sameFile(named, ledgerFile.stat)) throw new Error('DISPOSITION_LEDGER_CHANGED')
  }
  const boundaryUnchanged = () => {
    unchanged()
    const currentDir = fs.lstatSync(directory), currentReport = fs.lstatSync(reportFile.filename)
    if (!currentDir.isDirectory() || !owned(currentDir) || currentDir.mode & 0o077 || currentDir.dev !== dirStat.dev || currentDir.ino !== dirStat.ino || !currentReport.isFile() || !owned(currentReport) || currentReport.mode & 0o077 || !sameFile(currentReport, reportFile.stat)) throw new Error('DISPOSITION_REPORT_OR_DIRECTORY_CHANGED')
    bindings.entries.assertUnchanged?.()
  }
  function readLine(descriptor) {
    unchanged()
    const bytes = Buffer.alloc(descriptor.length)
    let offset = 0
    while (offset < bytes.length) { const count = fs.readSync(fd, bytes, offset, bytes.length - offset, descriptor.offset + offset); if (!count) throw new Error('DISPOSITION_LEDGER_TRUNCATED'); offset += count }
    if (sha256(bytes) !== descriptor.lineHash) throw new Error('DISPOSITION_LEDGER_CHANGED')
    return JSON.parse(bytes)
  }
  try {
    let chunks = [], lineBytes = 0, lineOffset = 0, offset = 0
    const accept = bytes => {
      if (bytes.length < 2 || bytes.at(-1) !== 10) throw new Error('DISPOSITION_LEDGER_LINE_REQUIRED')
      const change = JSON.parse(bytes)
      if (!isHash(change.recordKeyHash) || index.has(change.recordKeyHash) || !isHash(change.beforeHash) || !(change.afterHash === null || isHash(change.afterHash))) throw new Error('INVALID_DISPOSITION_OPERATION')
      index.set(change.recordKeyHash, { offset: lineOffset, length: bytes.length, lineHash: sha256(bytes) })
      lineOffset += bytes.length
    }
    const buffer = Buffer.alloc(64 * 1024)
    while (offset < ledgerFile.stat.size) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, offset)
      if (!count) throw new Error('DISPOSITION_LEDGER_TRUNCATED')
      const chunk = buffer.subarray(0, count); hash.update(chunk); offset += count
      let start = 0
      for (let i = 0; i < count; i++) if (chunk[i] === 10) {
        const part = chunk.subarray(start, i + 1); lineBytes += part.length
        if (lineBytes > MAX_LINE_BYTES) throw new Error('DISPOSITION_BACKUP_ENTRY_EXCEEDS_BOUND')
        chunks.push(Buffer.from(part)); accept(Buffer.concat(chunks, lineBytes)); chunks = []; lineBytes = 0; start = i + 1
      }
      if (start < count) { chunks.push(Buffer.from(chunk.subarray(start))); lineBytes += count - start; if (lineBytes > MAX_LINE_BYTES) throw new Error('DISPOSITION_BACKUP_ENTRY_EXCEEDS_BOUND') }
    }
    if (lineBytes || hash.digest('hex') !== report.ledgerSha256 || index.size !== report.changedRecords) throw new Error('DISPOSITION_LEDGER_HASH_OR_COUNT_MISMATCH')
    const regeneratedKeys = new Set()
    const regenerated = createMediaDisposition(bindings.entries, bindings.manifest, bindings.inventoryBytes, { datasets: bindings.datasets, expectedInventoryHash: bindings.inventoryReportHash, candidateManifestHash: bindings.candidateManifestHash, target: bindings.target, decision: bindings.decision, onChange(change) {
      const expected = index.get(change.recordKeyHash)
      if (!expected || sha256(Buffer.from(JSON.stringify(change) + '\n')) !== expected.lineHash) throw new Error('DISPOSITION_NOT_DETERMINISTIC_SOURCE_TRANSFORM')
      regeneratedKeys.add(change.recordKeyHash)
    } })
    if (regeneratedKeys.size !== index.size || canonical({ ...regenerated, ledgerSha256: report.ledgerSha256 }) !== canonical(report)) throw new Error('DISPOSITION_REGENERATION_MISMATCH')
    boundaryUnchanged()
    const binding = { complete: true, reportHash: bindings.expectedDispositionHash, run: report.run, datasets: report.datasets, candidateManifestHash: report.candidateManifestHash, sourceHash: report.sourceHash, referenceHash: report.referenceHash, inventoryReportHash: report.inventoryReportHash, inventoryHash: report.inventoryHash, operationsHash: report.operationsHash, ledgerSha256: report.ledgerSha256, decision: report.decision, userAuthorization: report.userAuthorization, target: report.target, changedRecords: report.changedRecords, deletedGalleryRecords: report.deletedGalleryRecords, repositoryTombstones: report.repositoryTombstones, deletedRepositoryRecords: report.deletedRepositoryRecords, deletedNativeRecords: report.deletedNativeRecords }
    return { report, binding, close() { if (!closed) { closed = true; fs.closeSync(fd) } }, createOverlay() {
      const used = new Set()
      const transform = document => {
        if (closed) throw new Error('DISPOSITION_LEDGER_CLOSED')
        const keyHash = sha256(`talioDatasets/${document.dataset}/databases/${document.databaseName}/collections/${document.collectionName}/records/${document.recordKey}`)
        const descriptor = index.get(keyHash)
        if (!descriptor) return document
        if (used.has(keyHash)) throw new Error('DUPLICATE_DISPOSITION_RECORD_REPLAY')
        const change = readLine(descriptor)
        if (sha256(canonical(document)) !== change.beforeHash) throw new Error('DISPOSITION_BEFORE_RECORD_MISMATCH')
        used.add(keyHash)
        return change.after === null ? null : unpack(change.after)
      }
      return { transform, materializeNative: transform, binding, report: binding, assertComplete() { boundaryUnchanged(); if (used.size !== index.size) throw new Error('DISPOSITION_REPLAY_INCOMPLETE') } }
    } }
  } catch (error) { fs.closeSync(fd); closed = true; throw error }
}

async function main() {
  const [run, ...args] = process.argv.slice(2), flags = {}
  if (!/^[a-z][a-z0-9-]{7,79}$/.test(run || '')) throw new Error('EXPLICIT_MEDIA_DISPOSITION_RUN_REQUIRED')
  for (const arg of args) { const match = /^--(datasets|inventory|inventory-sha256|output|target-host|target-database|decision)=([^=]+)$/.exec(arg); if (!match || flags[match[1]]) throw new Error('INVALID_MEDIA_DISPOSITION_FLAG'); flags[match[1]] = match[2] }
  if (!flags.datasets || !isHash(flags['inventory-sha256']) || !/^[a-z0-9][a-z0-9.-]{0,119}\.json$/.test(flags.inventory || '') || flags.inventory.includes('..') || !/^media-disposition-[a-z0-9-]{8,60}$/.test(flags.output || '')) throw new Error('EXPLICIT_PROTECTED_MEDIA_DISPOSITION_OUTPUT_REQUIRED')
  const target = { host: flags['target-host'], databaseName: flags['target-database'] }
  if (flags.decision !== DECISION || !validTarget(target)) throw new Error('EXPLICIT_MEDIA_DISPOSITION_DECISION_AND_TARGET_REQUIRED')
  const root = path.resolve(__dirname, '../..'), directory = path.join(root, '.migration-data', run), output = path.join(root, '.migration-data', flags.output)
  if (!fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/).some(line => /^\/?\.migration-data\/?$/.test(line.trim()))) throw new Error('PROTECTED_MIGRATION_OUTPUT_MUST_BE_GIT_IGNORED')
  const manifestBytes = fs.readFileSync(path.join(directory, 'manifest.json')), manifest = JSON.parse(manifestBytes)
  if (manifest.run !== run || !manifest.complete) throw new Error('COMPLETE_SOURCE_EXPORT_REQUIRED')
  const inventoryFile = path.join(directory, flags.inventory)
  if (!fs.lstatSync(inventoryFile).isFile() || fs.statSync(inventoryFile).size > 16 * 1024 * 1024) throw new Error('BOUNDED_REGULAR_INVENTORY_REQUIRED')
  const inventoryBytes = fs.readFileSync(inventoryFile)
  if (sha256(inventoryBytes) !== flags['inventory-sha256']) throw new Error('EXACT_COMPLETE_MEDIA_INVENTORY_HASH_REQUIRED')
  const entries = await loadIndexedEntries(directory, manifest)
  let fd
  try {
    const datasets = flags.datasets.split(',')
    fs.mkdirSync(output, { mode: 0o700 })
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ complete: false, sourceManifestHash: sha256(manifestBytes), inventoryReportHash: flags['inventory-sha256'] }), { mode: 0o600, flag: 'wx' })
    fd = fs.openSync(path.join(output, 'changes.ndjson'), 'wx', 0o600)
    const ledgerHash = require('node:crypto').createHash('sha256')
    const report = createMediaDisposition(entries, manifest, inventoryBytes, { datasets, target, decision: flags.decision, expectedInventoryHash: flags['inventory-sha256'], candidateManifestHash: sha256(manifestBytes), onChange: change => {
      const bytes = Buffer.from(JSON.stringify(change) + '\n')
      if (bytes.length > MAX_LINE_BYTES) throw new Error('DISPOSITION_BACKUP_ENTRY_EXCEEDS_BOUND')
      ledgerHash.update(bytes)
      let offset = 0
      while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset)
    } })
    report.ledgerSha256 = ledgerHash.digest('hex')
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined
    entries.assertUnchanged()
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ ...report, complete: true }, null, 2) + '\n', { mode: 0o600 })
    console.log(JSON.stringify(report, null, 2))
  } finally { if (fd !== undefined) fs.closeSync(fd); entries.close() }
}
if (require.main === module) main().catch(() => { console.error(JSON.stringify({ event: 'offline-media-disposition-failed', privateDetailsOmitted: true })); process.exitCode = 1 })
module.exports = { createMediaDisposition, validateInventory, loadDispositionLedger, DECISION }
