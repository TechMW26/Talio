#!/usr/bin/env node
'use strict'

// Explicit target-only cleanup while every selected catalog is non-writable.
// Source archives and Blob bytes are never changed. Exact before-images must
// already exist in the protected offline ledger; mismatches abort the batch.
const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const { BSON } = require('bson')
const { unpack } = require('../../lib/platform/firestoreCodec.cjs')
const { sha256, canonical, assertTarget } = require('./core.cjs')
const { assertFence } = require('./apply-delta.cjs')
const hashDocument = value => value ? sha256(canonical(value)) : null

function validateChanges(changes, report) {
  if (report?.command !== 'offline-media-disposition' || report.complete !== true || report.userAuthorization !== 'remove-unavailable-media-only' || report.sourceArchiveUnmodified !== true || report.changedRecords !== changes.length || changes.length > 10000) throw new Error('AUTHORIZED_EXACT_MEDIA_DISPOSITION_REQUIRED')
  const operationsHash = require('node:crypto').createHash('sha256'), identities = new Set()
  for (const change of changes) {
    const before = unpack(change.before), after = change.after === null ? null : unpack(change.after)
    if (!before?._id || !report.datasets.includes(before.dataset) || identities.has(before._id) || hashDocument(before) !== change.beforeHash || hashDocument(after) !== change.afterHash || after && ['_id', 'dataset', 'databaseName', 'collectionName', 'recordKey'].some(key => after[key] !== before[key]) || !['remove-unavailable-gallery-record', 'tombstone-unavailable-repository-record', 'retain-owned-available-immutable-backup', 'remove-unavailable-media-references', 'remove-unavailable-repository-record'].includes(change.reason)) throw new Error('MEDIA_DISPOSITION_CHANGE_IDENTITY_MISMATCH')
    if (!after && !before.collectionName.endsWith('.files') && !['screenshots', 'screenshotcomposites'].includes(before.collectionName)) throw new Error('BUSINESS_RECORD_DELETION_FORBIDDEN')
    if (Math.max(BSON.calculateObjectSize(before), after ? BSON.calculateObjectSize(after) : 0) > 15 * 1024 * 1024) throw new Error('BOUNDED_MEDIA_DISPOSITION_RECORD_REQUIRED')
    identities.add(before._id)
    operationsHash.update(JSON.stringify([change.recordKeyHash, change.reason, change.beforeHash, change.afterHash]) + '\n')
  }
  if (operationsHash.digest('hex') !== report.operationsHash) throw new Error('EXACT_MEDIA_DISPOSITION_OPERATION_HASH_REQUIRED')
}

async function applyDisposition({ db, client, changes, report, reportHash, prepareFence = false }) {
  validateChanges(changes, report)
  const context = { baselineRun: report.run, candidateRun: report.run, datasets: report.datasets }
  const control = db.collection('talio_migration_controls'), records = db.collection('talio_records')
  if (prepareFence) {
    const catalogs = await db.collection('talio_catalogs').find({ _id: { $in: report.datasets } }).toArray()
    if (catalogs.length !== report.datasets.length || catalogs.some(value => value.applicationCutover !== false || value.mongoVerified !== false)) throw new Error('TARGET_CATALOG_MUST_REMAIN_UNVERIFIED_AND_NON_WRITABLE')
    await control.updateOne({ _id: 'write-fence' }, { $setOnInsert: { active: true, ...context, purpose: 'authorized-media-disposition-before-final-cutover', createdAt: new Date() } }, { upsert: true })
  }
  await assertFence(db, context)
  const session = client.startSession()
  let changed = 0, resumed = 0
  try {
    // One bounded record per transaction avoids oversized before-image/parts
    // bundles and isolates resumable exact after-state checks.
    for (const change of changes) {
      const before = unpack(change.before), after = change.after === null ? null : unpack(change.after)
      let outcome
      await session.withTransaction(async () => {
        outcome = null
        await assertFence(db, context, session)
        const actual = await records.findOne({ _id: before._id, dataset: before.dataset, databaseName: before.databaseName, collectionName: before.collectionName }, { session })
        const currentHash = hashDocument(actual)
        const checkpointId = `media-disposition/${reportHash}/${before._id}`
        const checkpoint = await control.findOne({ _id: checkpointId }, { session })
        if (checkpoint) {
          if (checkpoint.beforeHash !== change.beforeHash || checkpoint.afterHash !== change.afterHash || currentHash !== change.afterHash) throw new Error('MEDIA_DISPOSITION_RESUME_STATE_MISMATCH')
          outcome = 'resumed'; return
        }
        if (currentHash !== change.beforeHash) throw new Error('MEDIA_DISPOSITION_CURRENT_BEFORE_IMAGE_MISMATCH')
        const lock = await control.updateOne({ _id: 'write-fence', active: true, baselineRun: context.baselineRun, candidateRun: context.candidateRun }, { $set: { lastMediaDispositionHash: reportHash } }, { session })
        if (lock.matchedCount !== 1) throw new Error('TARGET_MAINTENANCE_FENCE_RELEASED')
        if (after) {
          const result = await records.replaceOne({ _id: before._id }, after, { session })
          if (result.matchedCount !== 1) throw new Error('MEDIA_DISPOSITION_RECORD_CHANGED')
        } else {
          const result = await records.deleteOne({ _id: before._id }, { session })
          if (result.deletedCount !== 1) throw new Error('MEDIA_DISPOSITION_RECORD_CHANGED')
        }
        await control.insertOne({ _id: checkpointId, reportHash, recordId: before._id, beforeHash: change.beforeHash, afterHash: change.afterHash, committedAt: new Date() }, { session })
        outcome = 'changed'
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary', maxCommitTimeMS: 30000 })
      if (outcome === 'changed') changed++
      else if (outcome === 'resumed') resumed++
      else throw new Error('MEDIA_DISPOSITION_TRANSACTION_NOT_CONFIRMED')
    }
  } finally { await session.endSession() }
  await assertFence(db, context)
  for (const change of changes) {
    const before = unpack(change.before)
    if (hashDocument(await records.findOne({ _id: before._id })) !== change.afterHash) throw new Error('MEDIA_DISPOSITION_AFTER_IMAGE_VERIFICATION_FAILED')
  }
  return { command: 'apply-authorized-media-disposition', complete: true, reportHash, changedRecords: changed, resumedRecords: resumed, afterImagesVerified: changes.length, sourceWrites: 0, mediaWrites: 0, catalogsActivated: false, sourceArchiveUnmodified: true, finalCutoverComplete: false, finalDeltaMustAccountForDisposition: true }
}

async function main() {
  process.umask(0o077)
  const [name, ...args] = process.argv.slice(2), flags = {}
  if (!/^media-disposition-[a-z0-9-]{8,60}$/.test(name || '')) throw new Error('EXACT_PROTECTED_DISPOSITION_DIRECTORY_REQUIRED')
  for (const arg of args) {
    if (arg === '--execute' || arg === '--prepare-fence') { if (flags[arg]) throw new Error('DUPLICATE_DISPOSITION_FLAG'); flags[arg] = true; continue }
    const match = /^--(host|database|report-sha256|inventory)=([^=]+)$/.exec(arg)
    if (!match || flags[match[1]]) throw new Error('INVALID_DISPOSITION_APPLY_FLAG')
    flags[match[1]] = match[2]
  }
  const root = path.resolve(__dirname, '../..'), directory = path.join(root, '.migration-data', name)
  function readProtected(file, maximum) {
    const fd = fs.openSync(path.join(directory, file), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o077 || stat.size > maximum) throw new Error('PROTECTED_DISPOSITION_LEDGER_REQUIRED'); return fs.readFileSync(fd) } finally { fs.closeSync(fd) }
  }
  const reportBytes = readProtected('report.json', 1024 * 1024), report = JSON.parse(reportBytes)
  if (!/^[a-f0-9]{64}$/.test(flags['report-sha256'] || '') || sha256(reportBytes) !== flags['report-sha256']) throw new Error('EXACT_DISPOSITION_REPORT_HASH_REQUIRED')
  const changeBytes = readProtected('changes.ndjson', 128 * 1024 * 1024)
  if (sha256(changeBytes) !== report.ledgerSha256) throw new Error('EXACT_DISPOSITION_LEDGER_HASH_REQUIRED')
  const changes = changeBytes.toString().split('\n').filter(Boolean).map(line => JSON.parse(line))
  validateChanges(changes, report)
  const readEnv = file => fs.existsSync(path.join(root, file)) ? dotenv.parse(fs.readFileSync(path.join(root, file))) : {}
  const env = { ...readEnv('.env'), ...readEnv('.env.local'), ...process.env }, target = assertTarget(env.MONGODB_URI, env.MONGODB_DATABASE, flags.host, flags.database)
  if (canonical(target) !== canonical(report.target)) throw new Error('DISPOSITION_SCOPE_BINDING_MISMATCH')
  if (!flags['--execute']) { console.log(JSON.stringify({ event: 'authorized-media-disposition-plan', changedRecords: changes.length, writes: 0, target })); return }
  if (process.env.MONGODB_MEDIA_DISPOSITION_CONFIRM !== 'remove-unavailable-media-only') throw new Error('EXPLICIT_MEDIA_DISPOSITION_CONFIRMATION_REQUIRED')
  if (!/^[a-z][a-z0-9-]{7,79}$/.test(report.run || '') || !/^[a-z0-9][a-z0-9.-]{0,119}\.json$/.test(flags.inventory || '') || flags.inventory.includes('..')) throw new Error('EXPLICIT_SOURCE_AND_INVENTORY_REQUIRED')
  const sourceDirectory = path.join(root, '.migration-data', report.run)
  const sourceRead = name => {
    const fd = fs.openSync(path.join(sourceDirectory, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o077 || stat.size > 16 * 1024 * 1024) throw new Error('PROTECTED_DISPOSITION_SOURCE_REQUIRED'); return fs.readFileSync(fd) } finally { fs.closeSync(fd) }
  }
  const manifestBytes = sourceRead('manifest.json'), manifest = JSON.parse(manifestBytes), inventoryBytes = sourceRead(flags.inventory)
  const { loadIndexedEntries, sourceCollectionsHash } = require('./migrate.cjs')
  const { loadDispositionLedger } = require('./media-disposition.cjs')
  const entries = await loadIndexedEntries(sourceDirectory, manifest)
  let ledger
  const { MongoClient } = require('mongodb'), client = new MongoClient(env.MONGODB_URI, { maxPoolSize: 2, promoteBuffers: true, serverSelectionTimeoutMS: 15000 })
  try {
    ledger = await loadDispositionLedger(directory, { expectedDispositionHash: flags['report-sha256'], entries, manifest, inventoryBytes, inventoryReportHash: sha256(inventoryBytes), run: manifest.run, datasets: report.datasets, candidateManifestHash: sha256(manifestBytes), sourceHash: sourceCollectionsHash(manifest.collections), referenceHash: report.referenceHash, target, decision: 'remove-unavailable-media-only' })
    await client.connect()
    const result = await applyDisposition({ db: client.db(target.databaseName), client, changes, report, reportHash: flags['report-sha256'], prepareFence: flags['--prepare-fence'] === true })
    fs.writeFileSync(path.join(directory, `application-${Date.now()}.json`), JSON.stringify({ ...result, target, verifiedAt: new Date().toISOString() }, null, 2), { mode: 0o600, flag: 'wx' })
    console.log(JSON.stringify(result))
  } finally { ledger?.close(); entries.close(); await client.close() }
}
if (require.main === module) main().catch(error => { console.error(JSON.stringify({ event: 'media-disposition-apply-failed', code: /^[A-Z][A-Z_]{1,100}$/.test(error.message || '') ? error.message : 'MEDIA_DISPOSITION_APPLY_FAILED', privateDetailsOmitted: true })); process.exitCode = 1 })
module.exports = { validateChanges, applyDisposition }
