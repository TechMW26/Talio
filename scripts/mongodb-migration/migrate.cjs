#!/usr/bin/env node
'use strict'

// Read-only exports first. Mongo import is an explicit allowlisted, non-deleting
// operation. A verified pass is NOT a point-in-time snapshot while writers run.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const readline = require('node:readline')
const dotenv = require('dotenv')
const { once } = require('node:events')
const { createHash } = require('node:crypto')
const { sha256, canonical, snapshotEntry, validateEntry, archiveDocument, decodeArchiveDocument, materializeRecord, materializeClaim, materializeCatalog, assertTarget, collectionSummary, assertSameSource } = require('./core.cjs')
const { unpack } = require('../../lib/platform/firestoreCodec.cjs')
const { mapLimit } = require('../firestore-migration/core.cjs')
const { BSON } = require('bson')
const { loadIndexedEntries, archiveBatches } = require('./indexed-archive.cjs')

function sourceCollectionsHash(collections) {
  if (!Array.isArray(collections)) throw new Error('EXPLICIT_SOURCE_COLLECTIONS_REQUIRED')
  // Firestore does not promise an identical child discovery order across runs.
  // Bind the entire verified tree without making incidental RPC order identity.
  return sha256(canonical([...collections].sort((a, b) => a.path.localeCompare(b.path))))
}

const SOURCE_VERIFICATION_EPOCH_PROTOCOL = 'full-body-topology-source-reread-v1'
function verifiedSourceEpoch(source, expected, now = Date.now()) {
  const timestamp = value => typeof value === 'string' ? Date.parse(value) : NaN
  const original = timestamp(expected.candidateStartedAt)
  const markers = ['verificationStartedAt', 'verificationProtocol', 'fullBodiesRead', 'fullTopologyVerified', 'metadataUpdateTimesVerified', 'noReuse', 'reusedDocuments', 'archiveUnchanged']
  if (!source || !markers.some(key => Object.hasOwn(source, key))) return { mode: 'candidate-export-start-v1', startedAt: expected.candidateStartedAt }
  const started = timestamp(source.verificationStartedAt), finished = timestamp(source.verifiedAt), exported = timestamp(expected.candidateExportFinishedAt)
  const sameDatasets = Array.isArray(source.datasets) && Array.isArray(expected.datasets) && canonical([...source.datasets].sort()) === canonical([...expected.datasets].sort())
  if (source.verificationProtocol !== SOURCE_VERIFICATION_EPOCH_PROTOCOL || source.complete !== true || source.unchangedAtRead !== true || source.fullBodiesRead !== true || source.fullTopologyVerified !== true || source.metadataUpdateTimesVerified !== true || source.noReuse !== true || source.reusedDocuments !== 0 || source.archiveUnchanged !== true || source.run !== expected.run || source.candidateManifestHash !== expected.candidateManifestHash || source.sourceHash !== expected.sourceHash || source.sourceHashVersion !== 'canonical-sorted-collections-v1' || source.sourceProject !== expected.sourceProject || source.sourceDatabase !== expected.sourceDatabase || !sameDatasets || !Number.isFinite(original) || !Number.isFinite(exported) || exported < original || !Number.isFinite(started) || started < exported || !Number.isFinite(finished) || finished < started || finished > now || !expected.sourceCounts || ['collectionsVerified', 'documentsVerified', 'missingParentsVerified'].some(key => !Number.isSafeInteger(source[key]) || source[key] < 0 || source[key] !== expected.sourceCounts[key])) throw new Error('BOUND_FULL_SOURCE_VERIFICATION_EPOCH_REQUIRED')
  return { mode: SOURCE_VERIFICATION_EPOCH_PROTOCOL, startedAt: source.verificationStartedAt, verifiedAt: source.verifiedAt }
}

function sourceTreeCounts(collections) {
  return { collectionsVerified: collections.length, documentsVerified: collections.reduce((total, item) => total + item.summary.documents, 0), missingParentsVerified: collections.reduce((total, item) => total + item.summary.missingParents, 0) }
}

async function verifySourceSnapshot(db, dir, manifest, options = {}) {
  if (manifest.complete !== true || options.verificationStartedAt !== undefined || options.onVerificationStarted !== undefined) throw new Error('COMPLETE_IMMUTABLE_SOURCE_VERIFICATION_INPUT_REQUIRED')
  const manifestFile = path.join(dir, 'manifest.json'), manifestBytes = await fsp.readFile(manifestFile)
  if (canonical(JSON.parse(manifestBytes)) !== canonical(manifest)) throw new Error('SOURCE_VERIFICATION_MANIFEST_CHANGED')
  const fingerprint = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
  const manifestFingerprint = fingerprint(fs.statSync(manifestFile, { bigint: true }))
  // All local archive checks finish before the first source-read epoch. Never
  // borrow the export start or accept an operator-provided timestamp.
  const archive = await loadIndexedEntries(dir, manifest)
  let verificationStartedAt
  try {
    archive.assertUnchanged()
    const reports = await exportTree(db, dir, manifest, true, { ...options, reuseUnchanged: false, onVerificationStarted: value => { verificationStartedAt = value } })
    archive.assertUnchanged()
    if (fingerprint(fs.statSync(manifestFile, { bigint: true })) !== manifestFingerprint || sha256(await fsp.readFile(manifestFile)) !== sha256(manifestBytes)) throw new Error('SOURCE_VERIFICATION_MANIFEST_CHANGED')
    // Old baseline manifests have no final dataset allowlist. They remain
    // verifiable, but never gain the new final-candidate epoch authority.
    if (!Array.isArray(manifest.datasets) || !manifest.datasets.length) return { run: manifest.run, verifiedAt: new Date().toISOString(), sourceHash: sourceCollectionsHash(reports), sourceHashVersion: 'canonical-sorted-collections-v1', unchangedAtRead: true, writerFreezeRequiredForCutover: true, complete: true }
    const report = { run: manifest.run, candidateManifestHash: sha256(manifestBytes), sourceProject: manifest.sourceProject, sourceDatabase: manifest.sourceDatabase, datasets: [...manifest.datasets].sort(), verificationProtocol: SOURCE_VERIFICATION_EPOCH_PROTOCOL, verificationStartedAt, verifiedAt: new Date().toISOString(), sourceHash: sourceCollectionsHash(reports), sourceHashVersion: 'canonical-sorted-collections-v1', unchangedAtRead: true, fullBodiesRead: true, fullTopologyVerified: true, metadataUpdateTimesVerified: true, noReuse: true, reusedDocuments: 0, archiveUnchanged: true, ...sourceTreeCounts(reports), writerFreezeRequiredForCutover: true, complete: true }
    verifiedSourceEpoch(report, { ...report, sourceHash: sourceCollectionsHash(manifest.collections), candidateStartedAt: manifest.startedAt, candidateExportFinishedAt: manifest.exportFinishedAt, sourceCounts: sourceTreeCounts(manifest.collections) })
    return report
  } finally { archive.close() }
}

function mediaDispositionBinding(overlay) {
  if (!overlay) return undefined
  const report = overlay.report
  if (typeof overlay.transform !== 'function' || typeof overlay.assertComplete !== 'function' || report?.complete !== true || report.decision !== 'remove-unavailable-media-only') throw new Error('AUDITED_MEDIA_DISPOSITION_REQUIRED')
  return report
}

function dispositionRecord(document, overlay) {
  if (!document || !overlay) return document
  const result = overlay.transform(document)
  if (result === null) return null
  if (!result || ['_id', 'dataset', 'databaseName', 'collectionName', 'recordKey'].some(key => result[key] !== document[key]) || !Array.isArray(result.parts)) throw new Error('MEDIA_DISPOSITION_NATIVE_IDENTITY_CHANGED')
  return result
}

async function loadNativeDisposition(entries, manifest, manifestBytes, datasets, flags, target) {
  const names = ['disposition', 'disposition-sha256', 'inventory', 'inventory-sha256', 'decision']
  if (!names.some(name => flags[name] !== undefined)) return null
  if (names.some(name => !flags[name]) || flags.decision !== 'remove-unavailable-media-only' || !path.isAbsolute(flags.disposition) || !path.isAbsolute(flags.inventory) || !/^[a-f0-9]{64}$/.test(flags['disposition-sha256']) || !/^[a-f0-9]{64}$/.test(flags['inventory-sha256']) || canonical(JSON.parse(manifestBytes)) !== canonical(manifest)) throw new Error('EXACT_PROTECTED_MEDIA_DISPOSITION_FLAGS_REQUIRED')
  const fd = fs.openSync(flags.inventory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  let inventoryBytes
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) throw new Error('PROTECTED_OWNED_MEDIA_INVENTORY_REQUIRED')
    inventoryBytes = fs.readFileSync(fd)
  } finally { fs.closeSync(fd) }
  if (sha256(inventoryBytes) !== flags['inventory-sha256']) throw new Error('EXACT_COMPLETE_MEDIA_INVENTORY_HASH_REQUIRED')
  const selected = Array.isArray(datasets) ? datasets : [datasets]
  // The deterministic ledger loader below independently regenerates and checks
  // the entire source plan. Avoid hydrating the same archive twice here.
  const referenceHash = JSON.parse(inventoryBytes).referenceHash
  if (!/^[a-f0-9]{64}$/.test(referenceHash || '')) throw new Error('EXACT_MEDIA_REFERENCE_HASH_REQUIRED')
  const { loadDispositionLedger } = require('./media-disposition.cjs')
  return loadDispositionLedger(flags.disposition, { expectedDispositionHash: flags['disposition-sha256'], run: manifest.run, datasets: selected, candidateManifestHash: sha256(manifestBytes), sourceHash: sourceCollectionsHash(manifest.collections), inventoryReportHash: flags['inventory-sha256'], referenceHash, target, decision: flags.decision, entries, manifest, inventoryBytes })
}

function planMongo(entries, manifest, selectedDatasets, { nativeDisposition } = {}) {
  entries.assertUnchanged?.()
  const disposition = mediaDispositionBinding(nativeDisposition)
  const datasets = Array.isArray(selectedDatasets) ? selectedDatasets : [selectedDatasets]
  const report = { rawCount: 0, recordCount: 0, claimCount: 0, catalogCount: 0, archiveBytes: 0, applicationBytes: 0, controlBytes: 0, largestDocumentBytes: 0, datasets }
  if (disposition) Object.assign(report, { sourceRecordCount: 0, omittedRecordCount: 0, transformedRecordCount: 0, rawSourceIntegrityUnmodified: true })
  function size(document) {
    const bytes = BSON.calculateObjectSize(document)
    if (bytes > 15 * 1024 * 1024) throw new Error('MONGO_DOCUMENT_EXCEEDS_SAFE_BSON_BOUND')
    report.largestDocumentBytes = Math.max(report.largestDocumentBytes, bytes)
    return bytes
  }
  for (const entry of entries.values()) {
    report.archiveBytes += size(archiveDocument(entry, manifest.run)); report.rawCount++
    for (const dataset of datasets) {
      const original = materializeRecord(entry, entries, dataset)
      const record = dispositionRecord(original, nativeDisposition)
      if (disposition && original) {
        report.sourceRecordCount++
        if (!record) report.omittedRecordCount++
        else if (record !== original && canonical(record) !== canonical(original)) report.transformedRecordCount++
      }
      if (record) { report.applicationBytes += size(record); report.recordCount++ }
      const claim = materializeClaim(entry, dataset)
      if (claim) { report.controlBytes += size(claim); report.claimCount++ }
    }
    const catalog = materializeCatalog(entry)
    if (catalog) { report.controlBytes += size(catalog); report.catalogCount++ }
  }
  report.payloadBytes = report.archiveBytes + report.applicationBytes + report.controlBytes
  // Index/compression overhead varies by Atlas configuration. Reserve generous
  // headroom rather than promising an exact storage bill from logical BSON size.
  report.conservativeStorageBytes = Math.ceil(report.payloadBytes * 1.35)
  report.freeTierBudgetBytes = 400 * 1024 * 1024
  report.fitsFreeTierWithHeadroom = report.conservativeStorageBytes <= report.freeTierBudgetBytes
  entries.assertUnchanged?.()
  nativeDisposition?.assertComplete()
  if (disposition) report.mediaDisposition = disposition
  return report
}

async function loadEntries(dir, manifest) {
  const entries = new Map()
  for (const collection of manifest.collections || []) {
    if (!/^[a-f0-9]{64}\.ndjson$/.test(collection.file)) throw new Error('INVALID_ARCHIVE_FILENAME')
    const file = path.join(dir, collection.file)
    const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
    const values = []
    for await (const line of lines) {
      if (!line) continue
      const entry = validateEntry(JSON.parse(line))
      if (entries.has(entry.path)) throw new Error('DUPLICATE_ARCHIVE_PATH')
      entries.set(entry.path, entry); values.push(entry)
    }
    if (JSON.stringify(collectionSummary(values)) !== JSON.stringify(collection.summary)) throw new Error('COLLECTION_ARCHIVE_MISMATCH')
  }
  return entries
}

async function writeJson(file, value) {
  await fsp.writeFile(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 })
  await fsp.rename(`${file}.tmp`, file)
}

async function retrySourceRead(action, operation, { attempts = 5, sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 6) throw new Error('INVALID_SOURCE_READ_RETRY_BOUND')
  const transient = new Set(['4', '8', '10', '13', '14', 'deadline-exceeded', 'resource-exhausted', 'aborted', 'internal', 'unavailable'])
  for (let attempt = 1; ; attempt++) {
    try { return await action() } catch (error) {
      const code = String(error.code).toLowerCase().replaceAll('_', '-')
      if (!transient.has(code) || attempt >= attempts) throw error
      console.log(JSON.stringify({ event: 'source-read-retry', operation, code, attempt, attempts }))
      await sleep(Math.min(5000, 250 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 100))
    }
  }
}

function orderSourceSnapshots(snapshots, batch, kind = 'FULL') {
  if (!Array.isArray(snapshots)) throw new Error(`SOURCE_${kind}_BATCH_IDENTITY_MISMATCH`)
  const byPath = new Map(snapshots.map(snapshot => [snapshot?.ref?.path, snapshot]))
  if (snapshots.length !== batch.length || byPath.size !== batch.length || snapshots.some(snapshot => typeof snapshot?.exists !== 'boolean') || new Set(batch.map(ref => ref.path)).size !== batch.length || batch.some(ref => !byPath.has(ref.path))) throw new Error(`SOURCE_${kind}_BATCH_IDENTITY_MISMATCH`)
  return batch.map(ref => byPath.get(ref.path))
}

async function readRecoveryBatch(db, batch, existing, retryOptions) {
  const metadata = orderSourceSnapshots(await retrySourceRead(() => db.getAll(...batch, { fieldMask: [] }), 'batch-document-metadata', retryOptions), batch, 'METADATA')
  const byPath = new Map(metadata.map(snapshot => [snapshot.ref.path, snapshot]))
  const version = snapshot => snapshot.updateTime ? { seconds: snapshot.updateTime.seconds, nanoseconds: snapshot.updateTime.nanoseconds } : null
  const validVersion = value => value && Number.isSafeInteger(value.seconds) && Number.isInteger(value.nanoseconds) && value.nanoseconds >= 0 && value.nanoseconds < 1000000000
  const canReuse = snapshot => {
    const previous = existing.get(snapshot.ref.path), currentVersion = version(snapshot)
    return previous?.exists === true && snapshot.exists === true && validVersion(previous.updateTime) && validVersion(currentVersion) && canonical(previous.updateTime) === canonical(currentVersion)
  }
  const needsFull = batch.filter(ref => byPath.get(ref.path).exists && !canReuse(byPath.get(ref.path)))
  const full = needsFull.length ? orderSourceSnapshots(await retrySourceRead(() => db.getAll(...needsFull), 'batch-changed-documents', retryOptions), needsFull) : []
  const fullByPath = new Map(full.map(snapshot => [snapshot.ref.path, snapshot]))
  let reused = 0
  const entries = batch.map(ref => {
    const snapshot = byPath.get(ref.path)
    if (canReuse(snapshot)) { reused++; return existing.get(ref.path) }
    return snapshotEntry(snapshot.exists ? fullByPath.get(ref.path) : snapshot)
  })
  return { entries, reused, fullFetched: full.length }
}

async function exportTree(db, dir, manifest, verify = false, { childConcurrency = Number(process.env.MONGODB_EXPORT_CHILD_CONCURRENCY || 16), batchSize = Number(process.env.MONGODB_EXPORT_BATCH_SIZE || 64), reuseUnchanged = false, retryOptions, onVerificationStarted } = {}) {
  if (!Number.isInteger(childConcurrency) || childConcurrency < 1 || childConcurrency > 128) throw new Error('INVALID_EXPORT_CHILD_CONCURRENCY')
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 256) throw new Error('INVALID_EXPORT_BATCH_SIZE')
  const recovery = !verify && manifest.recoveryGeneration === true
  if (recovery && manifest.complete === true) throw new Error('COMPLETED_RECOVERY_GENERATION_IS_IMMUTABLE')
  if (recovery && (!/^[a-z][a-z0-9-]{7,79}$/.test(manifest.sourceRecoveryRun || '') || !/^[a-f0-9]{64}$/.test(manifest.sourceRecoveryManifestHash || '') || manifest.sourceRecoveryRun === manifest.run)) throw new Error('EXPLICIT_RETAINED_RECOVERY_GENERATION_REQUIRED')
  if (recovery) {
    const retainedDir = path.join(path.dirname(dir), manifest.sourceRecoveryRun)
    if (path.resolve(retainedDir) === path.resolve(dir) || path.basename(dir) !== manifest.run || sha256(await fsp.readFile(path.join(retainedDir, 'manifest.json'))) !== manifest.sourceRecoveryManifestHash) throw new Error('RETAINED_RECOVERY_BASELINE_IDENTITY_MISMATCH')
  }
  const started = Date.now()
  let totalDocuments = 0, totalMissingParents = 0
  if (verify) onVerificationStarted?.(new Date(started).toISOString())
  const queue = (await retrySourceRead(() => db.listCollections(), 'root-collections', retryOptions)).map(ref => ref.path).sort()
  const seen = new Set(), reports = []
  const known = new Map((manifest.collections || []).map(item => [item.path, item]))
  while (queue.length) {
    const collectionPath = queue.shift()
    if (seen.has(collectionPath)) continue
    seen.add(collectionPath)
    const reference = db.collection(collectionPath)
    // listDocuments deliberately includes missing parents with subcollections.
    const refs = await retrySourceRead(() => reference.listDocuments(), 'collection-documents', retryOptions)
    if (!Array.isArray(refs) || refs.some(ref => typeof ref?.path !== 'string' || !ref.path.startsWith(`${collectionPath}/`) || ref.path.split('/').length !== collectionPath.split('/').length + 1) || new Set(refs.map(ref => ref.path)).size !== refs.length) throw new Error('SOURCE_COLLECTION_REFERENCE_IDENTITY_MISMATCH')
    refs.sort((a, b) => a.path.localeCompare(b.path))
    const previous = known.get(collectionPath)
    // Recovery bodies publish under a new identity, so an interrupted write
    // never invalidates an older manifest's still-authoritative body pointer.
    const file = recovery ? `${sha256(JSON.stringify([manifest.run, collectionPath, Date.now(), process.hrtime.bigint().toString()]))}.ndjson` : previous?.file || `${sha256(collectionPath)}.ndjson`
    let existing = null
    if (verify && !previous) throw new Error('NEW_SOURCE_COLLECTION')
    const temporaryFile = path.join(dir, `${file}.tmp`)
    // Hard links change ctime; establish preservation before capturing the
    // immutable reader fingerprint of the previous collection body.
    if (recovery && previous) await fsp.link(path.join(dir, previous.file), path.join(dir, `${previous.file}.preserved-${Date.now()}-${process.hrtime.bigint()}`))
    let output = null
    try {
      if (previous) existing = await loadIndexedEntries(dir, { collections: [previous] })
      if (!verify && (!previous || recovery)) {
        // A prior interruption may leave a partial or an uncheckpointed completed
        // collection. Preserve both before rebuilding; never truncate/delete them.
        for (const existingFile of [temporaryFile, path.join(dir, file)]) {
          try { await fsp.access(existingFile); await fsp.rename(existingFile, `${existingFile}.preserved-${Date.now()}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
        }
      }
      output = !verify && (!previous || recovery) ? fs.createWriteStream(temporaryFile, { mode: 0o600 }) : null
      const hash = createHash('sha256')
      let documents = 0, missingParents = 0
      let changedDocuments = 0, reusedDocuments = 0, fullDocumentsFetched = 0
      for (let offset = 0; offset < refs.length; offset += batchSize) {
        const batch = refs.slice(offset, offset + batchSize)
        const metadataReuse = recovery && reuseUnchanged === true && existing
        const read = metadataReuse ? await readRecoveryBatch(db, batch, existing, retryOptions) : { entries: orderSourceSnapshots(await retrySourceRead(() => db.getAll(...batch), 'batch-documents', retryOptions), batch).map(snapshotEntry), reused: 0, fullFetched: batch.length }
        reusedDocuments += read.reused; fullDocumentsFetched += read.fullFetched
        for (const entry of read.entries) {
          validateEntry(entry)
          if (existing) {
            if (!existing.has(entry.path)) { if (!recovery) throw new Error('NEW_SOURCE_DOCUMENT'); changedDocuments++ }
            else if (recovery) { if (canonical(existing.get(entry.path)) !== canonical(entry)) changedDocuments++ }
            else assertSameSource(existing.get(entry.path), entry)
          }
          hash.update(canonical(entry)); hash.update('\n')
          if (entry.exists) documents++; else missingParents++
          if (output && !output.write(JSON.stringify(entry) + '\n')) await once(output, 'drain')
        }
        // Unknown/legacy children are included, not just active application data.
        const children = await mapLimit(batch, childConcurrency, ref => retrySourceRead(() => ref.listCollections(), 'document-children', retryOptions))
        for (const child of children.flat()) queue.push(child.path)
        console.log(JSON.stringify({ event: verify ? 'source-verification-progress' : 'source-export-progress', collectionToken: sha256(collectionPath).slice(0, 16), collectionNumber: seen.size, documentsRead: Math.min(offset + batch.length, refs.length), documentsTotal: refs.length, childCollectionsFound: children.reduce((sum, item) => sum + item.length, 0), completedDocuments: totalDocuments, completedMissingParents: totalMissingParents, elapsedSeconds: Math.floor((Date.now() - started) / 1000), childConcurrency, reusedDocuments, fullDocumentsFetched }))
      }
      existing?.assertUnchanged()
      const summary = { documents, missingParents, sha256: hash.digest('hex') }
      if (previous && !recovery && JSON.stringify(previous.summary) !== JSON.stringify(summary)) throw new Error('SOURCE_COLLECTION_CHANGED')
      if (output) { output.end(); await once(output, 'finish'); await fsp.rename(path.join(dir, `${file}.tmp`), path.join(dir, file)) }
      const report = { path: collectionPath, file, summary }
      const currentPaths = recovery && existing ? new Set(refs.map(ref => ref.path)) : null
      totalDocuments += summary.documents; totalMissingParents += summary.missingParents
      reports.push(report)
      if (!verify) {
        known.set(collectionPath, report)
        manifest.collections = [...known.values()].sort((a, b) => a.path.localeCompare(b.path))
        await writeJson(path.join(dir, 'manifest.json'), manifest)
      }
      console.log(JSON.stringify({ event: verify ? 'source-collection-verified' : 'source-collection-exported', collectionToken: sha256(collectionPath).slice(0, 16), documents: summary.documents, missingParents: summary.missingParents, completedDocuments: totalDocuments, completedMissingParents: totalMissingParents, ...(recovery && previous ? { recoveryGeneration: true, changedDocuments, removedDocuments: [...existing.keys()].filter(key => !currentPaths.has(key)).length } : {}) }))
    } catch (error) { output?.destroy(); throw error }
    finally { existing?.close() }
  }
  if (verify && (reports.length !== known.size || [...known.keys()].some(key => !seen.has(key)))) throw new Error('SOURCE_COLLECTION_REMOVED')
  return reports
}

async function importMongo(db, entries, manifest, selectedDataset, verify = false, { onProgress, nativeDisposition } = {}) {
  entries.assertUnchanged?.()
  if (nativeDisposition && !verify) throw new Error('MEDIA_DISPOSITION_VERIFY_ONLY_NOT_IMPORT')
  const disposition = mediaDispositionBinding(nativeDisposition)
  const selectedDatasets = Array.isArray(selectedDataset) ? [...new Set(selectedDataset)].sort() : [selectedDataset]
  if (!selectedDatasets.length || selectedDatasets.some(dataset => !/^[a-z][a-z0-9-]{7,79}$/.test(dataset))) throw new Error('EXPLICIT_DATASET_ALLOWLIST_REQUIRED')
  for (const dataset of selectedDatasets) if (!entries.get(`talioDatasets/${dataset}`)?.exists) throw new Error('ACTIVE_DATASET_CATALOG_MISSING')
  const archive = db.collection('talio_firestore_archive')
  const records = db.collection('talio_records')
  const claims = db.collection('talio_unique_keys')
  const catalogs = db.collection('talio_catalogs')
  const state = db.collection('talio_migration_runs')
  const runHash = sha256(JSON.stringify([manifest.collections, selectedDatasets]))
  const marker = await state.findOne({ _id: manifest.run })
  if (marker && marker.sourceHash !== runHash) throw new Error('MIGRATION_RUN_CONFLICT')
  if (!verify) {
    await archive.createIndex({ run: 1, path: 1 }, { unique: true })
    await records.createIndex({ dataset: 1, databaseName: 1, collectionName: 1, recordKey: 1 }, { unique: true })
    await state.updateOne({ _id: manifest.run }, { $setOnInsert: { sourceHash: runHash, startedAt: new Date(), datasets: selectedDatasets, status: 'importing' } }, { upsert: true })
  }
  let rawCount = 0, recordCount = 0, claimCount = 0, catalogCount = 0
  let sourceRecordCount = 0, omittedRecordCount = 0, transformedRecordCount = 0
  const started = Date.now()
  let nextProgress = 4096
  for (const batch of archiveBatches(entries)) {
    const raw = batch.map(entry => archiveDocument(entry, manifest.run))
    const sourceNative = batch.flatMap(entry => selectedDatasets.map(dataset => materializeRecord(entry, entries, dataset))).filter(Boolean)
    const native = [], omittedIds = []
    for (const original of sourceNative) {
      const cleaned = dispositionRecord(original, nativeDisposition)
      if (!cleaned) { omittedIds.push(original._id); omittedRecordCount++ }
      else {
        if (cleaned !== original && canonical(cleaned) !== canonical(original)) transformedRecordCount++
        native.push(cleaned)
      }
    }
    sourceRecordCount += sourceNative.length
    const unique = batch.flatMap(entry => selectedDatasets.map(dataset => materializeClaim(entry, dataset))).filter(Boolean)
    const catalog = batch.map(materializeCatalog).filter(Boolean)
    if (verify) {
      if (omittedIds.length && await records.countDocuments({ _id: { $in: omittedIds } }) !== 0) throw new Error('INTENTIONALLY_OMITTED_MEDIA_RECORD_STILL_PRESENT')
      const actualRaw = await resolveSharedArchiveDocuments(archive, await archive.find({ _id: { $in: raw.map(doc => doc._id) } }).toArray())
      const byId = new Map(actualRaw.map(doc => [doc._id, doc]))
      for (let index = 0; index < batch.length; index++) {
        const saved = byId.get(raw[index]._id)
        if (!saved) throw new Error('MONGO_ARCHIVE_DOCUMENT_MISSING')
        const decoded = decodeArchiveDocument(saved)
        assertSameSource(batch[index], decoded)
        // Raw protobuf equality alone does not cover the derived application
        // projection or the ledger's routing/identity metadata.
        if (canonical(decoded) !== canonical(batch[index]) || saved.run !== manifest.run || saved.path !== raw[index].path || saved.exists !== raw[index].exists || saved.sha256 !== raw[index].sha256 || saved.payloadSha256 !== raw[index].payloadSha256) throw new Error('MONGO_ARCHIVE_IDENTITY_OR_PAYLOAD_MISMATCH')
      }
      const actualNative = native.length ? await records.find({ _id: { $in: native.map(doc => doc._id) } }).toArray() : []
      const nativeById = new Map(actualNative.map(doc => [doc._id, doc]))
      for (const expected of native) {
        const actual = nativeById.get(expected._id)
        if (!actual) throw new Error('MONGO_APPLICATION_RECORD_MISMATCH')
        // Checked decoding alone ignores extra/unreferenced or duplicate parts.
        // Exact bundle identity prevents silently retaining those target bytes.
        if (canonical(actual.parts) !== canonical(expected.parts)) throw new Error('MONGO_APPLICATION_PART_MISMATCH')
        if (canonical(actual) !== canonical(expected)) throw new Error('MONGO_APPLICATION_RECORD_MISMATCH')
        // Verify reconstructed content too, not only an untrusted stored digest.
        const { decodeApplicationRecord, recordDigest } = require('../../lib/platform/firestoreCodec.cjs')
        if (recordDigest(decodeApplicationRecord(actual.envelope, new Map(actual.parts.map(part => [part.id, part.value])))) !== expected.digest) throw new Error('MONGO_APPLICATION_PART_MISMATCH')
      }
      const actualClaims = unique.length ? await claims.find({ _id: { $in: unique.map(doc => doc._id) } }).toArray() : []
      const claimsById = new Map(actualClaims.map(doc => [doc._id, doc]))
      for (const expected of unique) if (canonical(claimsById.get(expected._id)) !== canonical(expected)) throw new Error('MONGO_UNIQUE_CLAIM_MISMATCH')
      const actualCatalogs = catalog.length ? await catalogs.find({ _id: { $in: catalog.map(doc => doc._id) } }).toArray() : []
      const catalogsById = new Map(actualCatalogs.map(doc => [doc._id, doc]))
      for (const expected of catalog) if (canonical(catalogsById.get(expected._id)) !== canonical(expected)) throw new Error('MONGO_CATALOG_MISMATCH')
    } else {
      // Insert-only on retries: no existing application changes are overwritten.
      await archive.bulkWrite(raw.map(doc => ({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } })), { ordered: false })
      if (native.length) await records.bulkWrite(native.map(doc => ({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } })), { ordered: false })
      if (unique.length) await claims.bulkWrite(unique.map(doc => ({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } })), { ordered: false })
      if (catalog.length) await catalogs.bulkWrite(catalog.map(doc => ({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } })), { ordered: false })
    }
    rawCount += raw.length; recordCount += native.length; claimCount += unique.length; catalogCount += catalog.length
    if (onProgress && (rawCount >= nextProgress || rawCount === entries.size)) {
      onProgress({ rawCount, recordCount, claimCount, catalogCount, archiveEntries: entries.size, elapsedSeconds: Math.floor((Date.now() - started) / 1000) })
      nextProgress = rawCount + 4096
    }
  }
  entries.assertUnchanged?.()
  nativeDisposition?.assertComplete()
  if (verify) {
    if (await archive.countDocuments({ run: manifest.run }) !== rawCount || await records.countDocuments({ dataset: { $in: selectedDatasets } }) !== recordCount || await claims.countDocuments({ dataset: { $in: selectedDatasets } }) !== claimCount || await catalogs.countDocuments({}) !== catalogCount) throw new Error('MONGO_TOTAL_COUNT_MISMATCH')
  } else {
    // Raw catalog and all control records remain losslessly in the archive.
    await state.updateOne({ _id: manifest.run }, { $set: { rawCount, recordCount, claimCount, catalogCount, status: 'imported-awaiting-independent-verification', finishedAt: new Date() } })
  }
  return { rawCount, recordCount, claimCount, catalogCount, datasets: selectedDatasets, verified: verify, cutoverSafe: false, ...(disposition ? { mediaDisposition: disposition, sourceRecordCount, omittedRecordCount, transformedRecordCount, rawSourceIntegrityUnmodified: true } : {}) }
}

async function resolveSharedArchiveDocuments(archive, documents, options = {}) {
  const resolved = [...documents]
  for (let depth = 0; depth < 8; depth++) {
    const pending = resolved.filter(doc => !doc.bytes && doc.sharedPayloadFrom)
    if (!pending.length) return resolved
    const references = [...new Set(pending.map(doc => doc.sharedPayloadFrom))]
    if (references.some(id => !/^[a-f0-9]{64}$/.test(id))) throw new Error('INVALID_SHARED_ARCHIVE_REFERENCE')
    const originals = new Map((await archive.find({ _id: { $in: references } }, options).toArray()).map(doc => [doc._id, doc]))
    for (let index = 0; index < resolved.length; index++) {
      const doc = resolved[index]
      if (doc.bytes || !doc.sharedPayloadFrom) continue
      const original = originals.get(doc.sharedPayloadFrom)
      if (!original || original.path !== doc.path || original.sha256 !== doc.sha256 || original.payloadSha256 !== doc.payloadSha256 || original.run !== doc.sharedPayloadRun || original.codec !== doc.codec) throw new Error('SHARED_ARCHIVE_PAYLOAD_MISMATCH')
      resolved[index] = { ...doc, ...(original.bytes ? { bytes: original.bytes } : { sharedPayloadFrom: original.sharedPayloadFrom, sharedPayloadRun: original.sharedPayloadRun }) }
    }
  }
  throw new Error('SHARED_ARCHIVE_REFERENCE_DEPTH_EXCEEDED')
}

async function main() {
  process.umask(0o077)
  const [command, run, ...args] = process.argv.slice(2)
  if (!['inventory', 'export', 'verify-source', 'plan', 'import', 'verify-mongo'].includes(command) || !/^[a-z][a-z0-9-]{7,79}$/.test(run || '')) throw new Error('Usage: migrate.cjs inventory|export|verify-source|plan|import|verify-mongo <run> [--host=host --database=name --datasets=dataset1,dataset2]')
  const root = path.resolve(__dirname, '../..')
  const readEnv = file => fs.existsSync(path.join(root, file)) ? dotenv.parse(fs.readFileSync(path.join(root, file))) : {}
  const env = { ...readEnv('.env'), ...readEnv('.env.local'), ...process.env }
  const dir = path.join(root, '.migration-data', run)
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
  const manifestFile = path.join(dir, 'manifest.json')
  const existing = fs.existsSync(manifestFile) ? JSON.parse(await fsp.readFile(manifestFile)) : null
  const manifest = existing || { version: 1, run, sourceProject: env.FIRESTORE_PROJECT_ID, sourceDatabase: env.FIRESTORE_DATABASE_ID || '(default)', selectedDataset: env.FIRESTORE_DATASET, consistency: 'per-document-read-with-second-pass-change-detection', complete: false, collections: [], startedAt: new Date().toISOString() }
  if (manifest.run !== run || manifest.sourceProject !== env.FIRESTORE_PROJECT_ID || manifest.sourceDatabase !== (env.FIRESTORE_DATABASE_ID || '(default)') || manifest.selectedDataset !== env.FIRESTORE_DATASET) throw new Error('SOURCE_CONFIGURATION_CHANGED')
  if (command === 'export' && manifest.recoveryGeneration === true && manifest.complete === true) throw new Error('COMPLETED_RECOVERY_GENERATION_IS_IMMUTABLE')
  if (['inventory', 'export', 'verify-source'].includes(command)) {
    const admin = require('firebase-admin')
    if (!env.FIRESTORE_PROJECT_ID || !env.FIRESTORE_SERVICE_ACCOUNT_JSON || process.env.FIRESTORE_EMULATOR_HOST) throw new Error('EXPLICIT_CLOUD_FIRESTORE_CREDENTIALS_REQUIRED')
    const app = admin.initializeApp({ projectId: env.FIRESTORE_PROJECT_ID, credential: admin.credential.cert(JSON.parse(env.FIRESTORE_SERVICE_ACCOUNT_JSON)) }, `mongo-export-${Date.now()}`)
    const db = require('firebase-admin/firestore').getFirestore(app, env.FIRESTORE_DATABASE_ID || '(default)')
    try {
      if (command === 'inventory') {
        const roots = await db.listCollections()
        const collections = await mapLimit(roots, 4, async ref => ({ path: ref.path, rootDocuments: (await ref.count().get()).data().count }))
        await writeJson(path.join(dir, 'root-inventory.json'), { sourceProject: manifest.sourceProject, sourceDatabase: manifest.sourceDatabase, collections, completeRecursiveInventory: false })
        console.log(JSON.stringify({ event: 'root-inventory', collections, completeRecursiveInventory: false }))
      } else {
        if (command === 'verify-source' && !manifest.complete) throw new Error('COMPLETE_EXPORT_REQUIRED')
        const options = { childConcurrency: Number(env.MONGODB_EXPORT_CHILD_CONCURRENCY || 16), batchSize: Number(env.MONGODB_EXPORT_BATCH_SIZE || 64), reuseUnchanged: env.MONGODB_EXPORT_REUSE_UNCHANGED === '1' }
        if (command === 'export') { const reports = await exportTree(db, dir, manifest, false, options); manifest.collections = reports; manifest.complete = true; manifest.exportFinishedAt = new Date().toISOString(); await writeJson(manifestFile, manifest) }
        else await writeJson(path.join(dir, 'source-verification.json'), await verifySourceSnapshot(db, dir, manifest, options))
      }
    } finally { await db.terminate(); await app.delete() }
  } else {
    if (!manifest.complete) throw new Error('COMPLETE_EXPORT_REQUIRED')
    const flags = {}
    for (const arg of args) { const match = /^--(host|database|datasets|disposition|disposition-sha256|inventory|inventory-sha256|decision)=([^=]+)$/.exec(arg); if (!match || flags[match[1]]) throw new Error('INVALID_TARGET_FLAG'); flags[match[1]] = match[2] }
    if (command === 'import' && ['disposition', 'disposition-sha256', 'inventory', 'inventory-sha256', 'decision'].some(name => flags[name])) throw new Error('MEDIA_DISPOSITION_VERIFY_ONLY_NOT_IMPORT')
    const entries = await loadIndexedEntries(dir, manifest, { onProgress: report => console.log(JSON.stringify({ event: 'archive-index-progress', ...report })) })
    let disposition
    try {
      const datasets = flags.datasets ? flags.datasets.split(',') : manifest.selectedDataset
      if (['disposition', 'disposition-sha256', 'inventory', 'inventory-sha256', 'decision'].some(name => flags[name])) {
        const target = assertTarget(env.MONGODB_URI, env.MONGODB_DATABASE, flags.host, flags.database)
        disposition = await loadNativeDisposition(entries, manifest, await fsp.readFile(manifestFile), datasets, flags, target)
      }
      if (command === 'plan') {
        const report = planMongo(entries, manifest, datasets, { nativeDisposition: disposition?.createOverlay() })
        await writeJson(path.join(dir, 'mongo-plan.json'), report)
        console.log(JSON.stringify({ event: 'mongo-import-plan', ...report }))
        return
      }
      if (command === 'import') {
        const plan = planMongo(entries, manifest, datasets)
        const budget = Number(env.MONGODB_MIGRATION_STORAGE_BUDGET_BYTES || plan.freeTierBudgetBytes)
        if (!Number.isSafeInteger(budget) || budget < 1 || plan.conservativeStorageBytes > budget) throw new Error('MONGO_IMPORT_EXCEEDS_EXPLICIT_STORAGE_BUDGET')
      }
      const databaseName = env.MONGODB_DATABASE || 'talio'
      assertTarget(env.MONGODB_URI, databaseName, flags.host, flags.database)
      const { MongoClient } = require('mongodb')
      const client = new MongoClient(env.MONGODB_URI, { maxPoolSize: 4, serverSelectionTimeoutMS: 15000, promoteBuffers: true })
      try {
        await client.connect()
        const result = await importMongo(client.db(databaseName), entries, manifest, datasets, command === 'verify-mongo', { nativeDisposition: disposition?.createOverlay(), onProgress: report => console.log(JSON.stringify({ event: `mongo-${command}-progress`, ...report })) })
        const report = { ...result, run, candidateManifestHash: sha256(await fsp.readFile(manifestFile)), sourceHash: sourceCollectionsHash(manifest.collections), sourceHashVersion: 'canonical-sorted-collections-v1', target: { host: flags.host, databaseName }, ...(command === 'verify-mongo' ? { verifiedAt: new Date().toISOString() } : {}) }
        await writeJson(path.join(dir, `${command}.json`), report)
        console.log(JSON.stringify({ event: `mongo-${command}-complete`, ...report }))
      } finally { await client.close() }
    } finally { disposition?.close(); entries.close() }
  }
}

if (require.main === module) main().catch(error => { console.error(JSON.stringify({ event: 'migration-failed', code: error.code || null, message: String(error.message).replace(/(?:mongodb(?:\+srv)?|https?):\/\/\S+/g, '[REDACTED_URI]') })); process.exitCode = 1 })
module.exports = { loadEntries, loadIndexedEntries, exportTree, verifySourceSnapshot, verifiedSourceEpoch, sourceTreeCounts, SOURCE_VERIFICATION_EPOCH_PROTOCOL, importMongo, planMongo, resolveSharedArchiveDocuments, sourceCollectionsHash, retrySourceRead, readRecoveryBatch, mediaDispositionBinding, dispositionRecord, loadNativeDisposition }
