'use strict'

// Read-only preparation. This new protocol is deliberately NOT accepted by
// the existing full-body source-reread activation gate.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { pack } = require('../../lib/platform/firestoreCodec.cjs')
const { snapshotEntry, validateEntry, canonical, sha256, protoValue } = require('./core.cjs')
const { loadIndexedEntries } = require('./indexed-archive.cjs')
const { sourceCollectionsHash } = require('./migrate.cjs')
const { timestamp, compareTimestamp, metadataRequest, readMetadataPage, ancestorPrefixes } = require('./fixed-epoch-metadata.cjs')

const PROTOCOL = 'fixed-epoch-metadata-exact-version-body-reuse-v1'
function sameTime(left, right) { try { return compareTimestamp(left, right) === 0 } catch { return false } }
function reusable(entry, metadata) {
  return Boolean(entry?.exists && entry.path === metadata.path && sameTime(entry.updateTime, metadata.updateTime) && (!entry.createTime || sameTime(entry.createTime, metadata.createTime)))
}
function checkDirectory(directory) {
  const absolute = path.resolve(directory)
  const stat = fs.lstatSync(absolute)
  if (!stat.isDirectory() || fs.realpathSync(absolute) !== absolute || (stat.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new Error('REAL_PRIVATE_ARCHIVE_DIRECTORY_REQUIRED')
  return absolute
}
function readManifest(directory, expectedHash) {
  const filename = path.join(directory, 'manifest.json')
  const manifestStat = fs.lstatSync(filename)
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || (manifestStat.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && manifestStat.uid !== process.getuid())) throw new Error('REAL_ARCHIVE_MANIFEST_REQUIRED')
  const bytes = fs.readFileSync(filename)
  if (!/^[a-f0-9]{64}$/.test(expectedHash || '') || sha256(bytes) !== expectedHash) throw new Error('BASELINE_MANIFEST_HASH_MISMATCH')
  const manifest = JSON.parse(bytes), names = new Set(), files = new Set()
  if (manifest.complete !== true || !/^[a-z][a-z0-9-]{7,79}$/.test(manifest.run || '') || !Array.isArray(manifest.collections)) throw new Error('COMPLETE_BASELINE_REQUIRED')
  for (const item of manifest.collections) {
    const segments = item.path?.split('/') || []
    if (!segments.length || segments.length % 2 !== 1 || segments.some(part => !part || part === '.' || part === '..') || names.has(item.path) || files.has(item.file) || !/^[a-f0-9]{64}\.ndjson$/.test(item.file || '')) throw new Error('INVALID_BASELINE_COLLECTION')
    const stat = fs.lstatSync(path.join(directory, item.file))
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new Error('REAL_ARCHIVE_FILE_REQUIRED')
    names.add(item.path); files.add(item.file)
  }
  return manifest
}

async function readBodies(client, rows, options) {
  if (!rows.length) return []
  if (options.signal?.aborted) throw new Error('FIXED_EPOCH_EXPORT_ABORTED')
  const request = metadataRequest(options), wanted = new Map(rows.map(row => [row.name, row]))
  if (rows.length > 100 || wanted.size !== rows.length || typeof client.batchGetDocuments !== 'function') throw new Error('BOUNDED_BODY_BATCH_REQUIRED')
  const deadlineMs = options.deadlineMs ?? 30000, documents = new Map()
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60000) throw new Error('BOUNDED_BODY_DEADLINE_REQUIRED')
  await new Promise((resolve, reject) => {
    const stream = client.batchGetDocuments({ database: request.parent.slice(0, -10), documents: [...wanted.keys()], readTime: request.readTime }, { timeout: deadlineMs, retry: null })
    let settled = false
    const finish = error => {
      if (settled) return
      settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort)
      if (error) { stream.cancel?.(); reject(error) } else resolve()
    }
    const abort = () => finish(new Error('FIXED_EPOCH_EXPORT_ABORTED'))
    const timer = setTimeout(() => finish(new Error('BOUNDED_BODY_STREAM_TIMEOUT')), deadlineMs)
    if (options.signal?.aborted) return abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    stream.on('error', error => { const safe = new Error('SOURCE_BODY_BATCH_FAILED'); if (Number.isInteger(error.code)) safe.code = error.code; finish(safe) })
    stream.on('data', response => {
      if (settled) return
      try {
        const doc = response?.found, metadata = wanted.get(doc?.name)
        if (!metadata || response.missing || !sameTime(response.readTime, request.readTime) || documents.has(doc.name) || !sameTime(doc.updateTime, metadata.updateTime) || !sameTime(doc.createTime, metadata.createTime) || (response.transaction && response.transaction.length)) throw new Error('EXACT_BODY_EPOCH_IDENTITY_VERSION_REQUIRED')
        documents.set(doc.name, doc)
      } catch (error) { finish(error) }
    })
    stream.on('end', () => documents.size === wanted.size ? finish() : finish(new Error('INCOMPLETE_BODY_BATCH')))
  })
  return rows.map(row => documents.get(row.name))
}

// Only small offsets/paths/hashes stay in memory; bodies are private on disk.
class CollectionSpools {
  constructor(directory) { this.directory = directory; this.collections = new Map() }
  append(entry) {
    validateEntry(entry)
    const collection = entry.path.slice(0, entry.path.lastIndexOf('/'))
    let group = this.collections.get(collection)
    if (!group) {
      const file = `${sha256(collection)}.ndjson`, spool = path.join(this.directory, `${file}.spool`)
      fs.closeSync(fs.openSync(spool, 'wx', 0o600))
      group = { path: collection, file, spool, offset: 0, entries: [] }; this.collections.set(collection, group)
    }
    const bytes = Buffer.from(JSON.stringify(entry) + '\n')
    fs.appendFileSync(group.spool, bytes)
    group.entries.push({ path: entry.path, offset: group.offset, length: bytes.length, hash: sha256(canonical(entry)) })
    group.offset += bytes.length
  }
  publish() {
    const reports = []
    for (const group of [...this.collections.values()].sort((a, b) => a.path.localeCompare(b.path))) {
      const source = fs.openSync(group.spool, 'r'), destination = fs.openSync(path.join(this.directory, group.file), 'wx', 0o600)
      const hash = createHash('sha256'); let documents = 0, missingParents = 0
      try {
        let previous = null
        for (const pointer of group.entries.sort((a, b) => a.path.localeCompare(b.path))) {
          if (pointer.path === previous) throw new Error('DUPLICATE_CANDIDATE_PATH')
          previous = pointer.path
          const bytes = Buffer.allocUnsafe(pointer.length)
          let read = 0
          while (read < bytes.length) {
            const count = fs.readSync(source, bytes, read, bytes.length - read, pointer.offset + read)
            if (!count) throw new Error('CANDIDATE_SPOOL_CHANGED')
            read += count
          }
          const entry = validateEntry(JSON.parse(bytes.toString('utf8'))), body = canonical(entry)
          if (entry.path !== pointer.path || sha256(body) !== pointer.hash) throw new Error('CANDIDATE_SPOOL_CHANGED')
          hash.update(body + '\n')
          for (let written = 0; written < bytes.length;) written += fs.writeSync(destination, bytes, written, bytes.length - written)
          if (entry.exists) documents++; else missingParents++
        }
        fs.fsyncSync(destination)
      } finally { fs.closeSync(source); fs.closeSync(destination) }
      reports.push({ path: group.path, file: group.file, summary: { documents, missingParents, sha256: hash.digest('hex') } })
      // Bound disk overhead to the largest single collection, not a second
      // complete copy of the dataset. These spools belong only to this run.
      fs.unlinkSync(group.spool); group.removed = true
    }
    return reports
  }
  removeOwnedSpools() { for (const group of this.collections.values()) if (!group.removed) fs.unlinkSync(group.spool) }
}

async function exportFixedEpochArchive(options) {
  const { client, run, baselineManifestHash, sourceProject, sourceDatabase, snapshotFromDocument } = options
  const batchSize = options.batchSize ?? 64, pageSize = options.pageSize ?? 1000
  const now = options.now ?? Date.now
  if (!/^[a-z][a-z0-9-]{7,79}$/.test(run || '') || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100 || typeof snapshotFromDocument !== 'function') throw new Error('EXPLICIT_FIXED_EPOCH_EXPORT_OPTIONS_REQUIRED')
  const readTime = timestamp(options.readTime)
  const scope = { sourceProject, sourceDatabase, readTime, limit: pageSize, deadlineMs: options.deadlineMs, now, signal: options.signal }
  metadataRequest(scope)
  const baselineDirectory = checkDirectory(options.baselineDirectory), directory = path.resolve(options.directory)
  if (path.basename(directory) !== run || directory === baselineDirectory || path.dirname(directory) !== checkDirectory(path.dirname(directory))) throw new Error('SEPARATE_CANDIDATE_DIRECTORY_REQUIRED')
  const baselineManifest = readManifest(baselineDirectory, baselineManifestHash)
  if (baselineManifest.run === run) throw new Error('SEPARATE_CANDIDATE_RUN_REQUIRED')
  if (baselineManifest.sourceProject !== sourceProject || baselineManifest.sourceDatabase !== sourceDatabase) throw new Error('SOURCE_SCOPE_CHANGED')
  let finalBinding = {}
  if (options.finalOptions !== undefined) {
    const final = options.finalOptions, drained = Date.parse(final?.writersDrainedAt)
    if (!final || !/^[a-z][a-z0-9-]{7,79}$/.test(final.targetBaselineRun || '') || final.targetBaselineRun === run || !/^[a-f0-9]{64}$/.test(final.targetBaselineManifestHash || '') || !/^[a-f0-9]{64}$/.test(final.writerDrainEvidenceHash || '') || !Number.isFinite(drained) || !Array.isArray(final.datasets) || !final.datasets.length || final.datasets.some(value => !/^[a-z][a-z0-9-]{7,79}$/.test(value)) || compareTimestamp(readTime, { seconds: String(Math.floor(drained / 1000)), nanos: (drained % 1000) * 1000000 }) < 0 || drained > now()) throw new Error('FRESH_POST_DRAIN_FINAL_EPOCH_REQUIRED')
    finalBinding = { finalSnapshot: true, sourceVerificationRequired: true, sourceBaselineRun: final.targetBaselineRun, sourceBaselineManifestHash: final.targetBaselineManifestHash, datasets: [...new Set(final.datasets)].sort(), writersDrainedAt: final.writersDrainedAt, writerDrainEvidenceHash: final.writerDrainEvidenceHash }
  }
  const archive = await loadIndexedEntries(baselineDirectory, baselineManifest)
  let candidate
  try {
    const collectionByFile = new Map(baselineManifest.collections.map(item => [path.join(baselineDirectory, item.file), item.path]))
    for (const [key, descriptor] of archive.index) if (key.slice(0, key.lastIndexOf('/')) !== collectionByFile.get(descriptor.file.filename)) throw new Error('BASELINE_COLLECTION_PATH_MISMATCH')
    fs.mkdirSync(directory, { mode: 0o700 }) // Existing candidates are immutable.
    candidate = new CollectionSpools(directory)
    const manifest = {
      version: 1, run, sourceProject, sourceDatabase,
      ...(baselineManifest.selectedDataset ? { selectedDataset: baselineManifest.selectedDataset } : {}),
      ...(baselineManifest.datasets ? { datasets: baselineManifest.datasets } : {}),
      consistency: PROTOCOL, verificationProtocol: PROTOCOL, readTime,
      baselineRun: baselineManifest.run, baselineManifestHash,
      startedAt: new Date(now()).toISOString(), complete: false,
      sourceWrites: 0, targetWrites: 0, applicationCutover: false, cutoverSafe: false,
      fullBodiesRead: false, noReuse: false, reusedDocuments: 0, fullDocumentsFetched: 0,
      metadataDocuments: 0, missingParents: 0, collections: [],
      ...finalBinding,
    }
    const writeManifest = value => fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(value, null, 2), { mode: 0o600 })
    writeManifest(manifest)
    const existing = new Set(), ancestors = new Set(), metadataHash = createHash('sha256'), pages = []
    let afterName
    for (;;) {
      const page = await readMetadataPage(client, { ...scope, ...(afterName ? { afterName } : {}) })
      pages.push({ afterName: afterName || null, lastName: page.afterName, rows: page.rows.length, responses: page.responses, done: page.done })
      for (let offset = 0; offset < page.rows.length; offset += batchSize) {
        const rows = page.rows.slice(offset, offset + batchSize), resolved = new Map(), changed = []
        for (const row of rows) {
          if (existing.has(row.path)) throw new Error('DUPLICATE_METADATA_DOCUMENT')
          existing.add(row.path); metadataHash.update(canonical(row) + '\n')
          for (const parent of ancestorPrefixes(row.name, scope).possibleMissingParents) ancestors.add(parent)
          const old = archive.get(row.path)
          // Preserve exact canonical archive identity for unchanged legacy
          // bodies; observed createTime is bound by metadataEvidence instead.
          if (reusable(old, row)) { resolved.set(row.path, old); manifest.reusedDocuments++ }
          else changed.push(row)
        }
        const documents = await readBodies(client, changed, scope)
        for (let index = 0; index < documents.length; index++) {
          const doc = documents[index], row = changed[index]
          const entry = snapshotEntry(snapshotFromDocument(doc, readTime))
          if (!entry.exists || entry.path !== row.path || !sameTime(entry.updateTime, row.updateTime) || canonical(entry.fields) !== canonical(pack(protoValue(doc.fields || {})))) throw new Error('DECODED_BODY_IDENTITY_MISMATCH')
          resolved.set(row.path, { ...entry, createTime: { seconds: row.createTime.seconds, nanoseconds: row.createTime.nanos } }); manifest.fullDocumentsFetched++
        }
        for (const row of rows) candidate.append(resolved.get(row.path))
        manifest.metadataDocuments += rows.length
      }
      options.onProgress?.({ pages: pages.length, metadataDocuments: manifest.metadataDocuments, reusedDocuments: manifest.reusedDocuments, fullDocumentsFetched: manifest.fullDocumentsFetched })
      if (page.done) break
      if (!page.afterName || page.afterName === afterName) throw new Error('METADATA_CURSOR_DID_NOT_ADVANCE')
      afterName = page.afterName
    }
    for (const parent of ancestors) if (!existing.has(parent)) { candidate.append(snapshotEntry({ exists: false, ref: { path: parent } })); manifest.missingParents++ }
    archive.assertUnchanged(); readManifest(baselineDirectory, baselineManifestHash)
    manifest.collections = candidate.publish()
    const audited = await loadIndexedEntries(directory, manifest)
    try { audited.assertUnchanged() } finally { audited.close() }
    archive.assertUnchanged(); readManifest(baselineDirectory, baselineManifestHash)
    manifest.metadataEvidence = { protocol: 'fixed-epoch-kindless-metadata-v1', pages, terminalPageObserved: pages.at(-1)?.done === true, metadataHash: metadataHash.digest('hex'), readTime, globallyOrdered: true }
    manifest.sourceHash = sourceCollectionsHash(manifest.collections)
    manifest.sourceHashVersion = 'canonical-sorted-collections-v1'
    manifest.fullBodiesRead = manifest.reusedDocuments === 0
    manifest.noReuse = manifest.reusedDocuments === 0
    manifest.archiveUnchanged = true
    manifest.complete = true; manifest.exportFinishedAt = new Date(now()).toISOString()
    candidate.removeOwnedSpools()
    writeManifest(manifest)
    return manifest
  } finally { archive.close() }
}

module.exports = { PROTOCOL, reusable, readBodies, exportFixedEpochArchive, readManifest, checkDirectory }
