#!/usr/bin/env node
'use strict'

// Restore audited native before-images only to an inactive, fenced baseline.
// This deliberately invalidates cleaned parity; final delta, fresh disposition,
// and complete parity/media verification are required before activation.
const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const { unpack } = require('../../lib/platform/firestoreCodec.cjs')
const { sha256, canonical, assertTarget } = require('./core.cjs')
const { assertFence } = require('./apply-delta.cjs')
const { validateChanges } = require('./apply-media-disposition.cjs')
const CONFIRMATION = 'restore-exact-media-disposition-before-images-under-maintenance'
const hashDocument = document => document ? sha256(canonical(document)) : null

async function restoreDisposition({ db, client, changes, report, reportHash }) {
  validateChanges(changes, report)
  if (!/^[a-f0-9]{64}$/.test(reportHash || '') || !/^[a-z][a-z0-9-]{7,79}$/.test(report.run || '') || !Array.isArray(report.datasets) || !report.datasets.length) throw new Error('EXACT_RESTORATION_SCOPE_REQUIRED')
  const context = { baselineRun: report.run, candidateRun: report.run, datasets: report.datasets }
  const control = db.collection('talio_migration_controls'), records = db.collection('talio_records')
  await assertFence(db, context)
  const session = client.startSession()
  let restored = 0, resumed = 0
  try {
    for (const change of changes) {
      const before = unpack(change.before)
      let outcome
      await session.withTransaction(async () => {
        outcome = null
        await assertFence(db, context, session)
        const applied = await control.findOne({ _id: `media-disposition/${reportHash}/${before._id}` }, { session })
        if (!applied || applied.reportHash !== reportHash || applied.recordId !== before._id || applied.beforeHash !== change.beforeHash || applied.afterHash !== change.afterHash) throw new Error('EXACT_APPLIED_DISPOSITION_CHECKPOINT_REQUIRED')
        // Query by global native ID: a foreign-scope collision must not look
        // absent and become an upsert/overwrite during a deleted-row restore.
        const current = await records.findOne({ _id: before._id }, { session })
        const currentHash = hashDocument(current)
        const checkpointId = `media-disposition-restore/${reportHash}/${before._id}`
        const checkpoint = await control.findOne({ _id: checkpointId }, { session })
        if (checkpoint) {
          if (checkpoint.reportHash !== reportHash || checkpoint.recordId !== before._id || checkpoint.run !== report.run || checkpoint.beforeHash !== change.beforeHash || checkpoint.afterHash !== change.afterHash || currentHash !== change.beforeHash) throw new Error('MEDIA_RESTORATION_RESUME_STATE_MISMATCH')
          outcome = 'resumed'; return
        }
        if (currentHash !== change.afterHash) throw new Error('MEDIA_RESTORATION_CURRENT_AFTER_IMAGE_MISMATCH')
        const locked = await control.updateOne({ _id: 'write-fence', active: true, baselineRun: context.baselineRun, candidateRun: context.candidateRun }, { $set: { lastMediaRestorationHash: reportHash } }, { session })
        if (locked.matchedCount !== 1) throw new Error('TARGET_MAINTENANCE_FENCE_RELEASED')
        if (current) {
          const replaced = await records.replaceOne({ _id: before._id, dataset: before.dataset, databaseName: before.databaseName, collectionName: before.collectionName, recordKey: before.recordKey }, before, { session })
          if (replaced.matchedCount !== 1) throw new Error('MEDIA_RESTORATION_RECORD_CHANGED')
        } else await records.insertOne(before, { session })
        await control.insertOne({ _id: checkpointId, reportHash, recordId: before._id, run: report.run, beforeHash: change.beforeHash, afterHash: change.afterHash, committedAt: new Date() }, { session })
        outcome = 'restored'
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary', maxCommitTimeMS: 30000 })
      if (outcome === 'restored') restored++
      else if (outcome === 'resumed') resumed++
      else throw new Error('MEDIA_RESTORATION_TRANSACTION_NOT_CONFIRMED')
    }
  } finally { await session.endSession() }
  await assertFence(db, context)
  for (const change of changes) {
    const before = unpack(change.before)
    if (hashDocument(await records.findOne({ _id: before._id })) !== change.beforeHash) throw new Error('MEDIA_RESTORATION_BEFORE_IMAGE_VERIFICATION_FAILED')
  }
  await assertFence(db, context)
  return { command: 'restore-exact-media-disposition-before-images', complete: true, reportHash, run: report.run, datasets: report.datasets, restoredRecords: restored, resumedRecords: resumed, beforeImagesVerified: changes.length, sourceWrites: 0, mediaWrites: 0, catalogsActivated: false, sourceArchiveUnmodified: true, cleanedParityInvalidated: true, finalDeltaRequired: true, freshDispositionAndParityRequired: true, finalCutoverComplete: false }
}

function readProtected(directory, name, maximum) {
  const fd = fs.openSync(path.join(directory, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o077 || stat.size > maximum) throw new Error('PROTECTED_RESTORATION_INPUT_REQUIRED')
    return fs.readFileSync(fd)
  } finally { fs.closeSync(fd) }
}

async function main() {
  process.umask(0o077)
  const [name, ...args] = process.argv.slice(2), flags = {}
  if (!/^media-disposition-[a-z0-9-]{8,60}$/.test(name || '')) throw new Error('EXACT_PROTECTED_DISPOSITION_DIRECTORY_REQUIRED')
  for (const arg of args) {
    if (arg === '--execute') { if (flags.execute) throw new Error('DUPLICATE_RESTORATION_FLAG'); flags.execute = true; continue }
    const match = /^--(host|database|report-sha256|inventory)=([^=]+)$/.exec(arg)
    if (!match || flags[match[1]]) throw new Error('INVALID_RESTORATION_FLAG')
    flags[match[1]] = match[2]
  }
  if (flags.execute && process.env.MONGODB_MEDIA_RESTORATION_CONFIRM !== CONFIRMATION) throw new Error('EXPLICIT_MEDIA_RESTORATION_CONFIRMATION_REQUIRED')
  const root = path.resolve(__dirname, '../..'), directory = path.join(root, '.migration-data', name)
  const reportBytes = readProtected(directory, 'report.json', 1024 * 1024), report = JSON.parse(reportBytes)
  if (!/^[a-f0-9]{64}$/.test(flags['report-sha256'] || '') || sha256(reportBytes) !== flags['report-sha256']) throw new Error('EXACT_DISPOSITION_REPORT_HASH_REQUIRED')
  const ledgerBytes = readProtected(directory, 'changes.ndjson', 128 * 1024 * 1024)
  if (sha256(ledgerBytes) !== report.ledgerSha256) throw new Error('EXACT_DISPOSITION_LEDGER_HASH_REQUIRED')
  const changes = ledgerBytes.toString().split('\n').filter(Boolean).map(line => JSON.parse(line))
  validateChanges(changes, report)
  const readEnv = name => fs.existsSync(path.join(root, name)) ? dotenv.parse(fs.readFileSync(path.join(root, name))) : {}
  const env = { ...readEnv('.env'), ...readEnv('.env.local'), ...process.env }
  const target = assertTarget(env.MONGODB_URI, env.MONGODB_DATABASE, flags.host, flags.database)
  if (canonical(target) !== canonical(report.target)) throw new Error('DISPOSITION_SCOPE_BINDING_MISMATCH')
  if (!/^[a-z][a-z0-9-]{7,79}$/.test(report.run || '') || !/^[a-z0-9][a-z0-9.-]{0,119}\.json$/.test(flags.inventory || '') || flags.inventory.includes('..')) throw new Error('EXPLICIT_SOURCE_AND_INVENTORY_REQUIRED')
  const sourceDirectory = path.join(root, '.migration-data', report.run)
  const manifestBytes = readProtected(sourceDirectory, 'manifest.json', 16 * 1024 * 1024), manifest = JSON.parse(manifestBytes)
  const inventoryBytes = readProtected(sourceDirectory, flags.inventory, 16 * 1024 * 1024)
  const { loadIndexedEntries, sourceCollectionsHash } = require('./migrate.cjs')
  const { loadDispositionLedger } = require('./media-disposition.cjs')
  const entries = await loadIndexedEntries(sourceDirectory, manifest)
  let ledger, client
  try {
    // Exact deterministic regeneration binds every native image and raw backup
    // to the immutable source + confirmed missing-media inventory. Even plan
    // mode rejects a merely rehashed arbitrary ledger without opening Mongo.
    ledger = await loadDispositionLedger(directory, { expectedDispositionHash: flags['report-sha256'], entries, manifest, inventoryBytes, inventoryReportHash: sha256(inventoryBytes), run: manifest.run, datasets: report.datasets, candidateManifestHash: sha256(manifestBytes), sourceHash: sourceCollectionsHash(manifest.collections), referenceHash: report.referenceHash, target, decision: 'remove-unavailable-media-only' })
    if (!flags.execute) { console.log(JSON.stringify({ event: 'exact-media-restoration-plan', changedRecords: changes.length, writes: 0, target, cleanedParityWillBeInvalidated: true })); return }
    const { MongoClient } = require('mongodb')
    client = new MongoClient(env.MONGODB_URI, { maxPoolSize: 2, promoteBuffers: true, serverSelectionTimeoutMS: 15000 })
    await client.connect()
    const result = await restoreDisposition({ db: client.db(target.databaseName), client, changes, report, reportHash: flags['report-sha256'] })
    entries.assertUnchanged?.()
    fs.writeFileSync(path.join(directory, `restoration-${Date.now()}.json`), JSON.stringify({ ...result, target, verifiedAt: new Date().toISOString() }, null, 2), { mode: 0o600, flag: 'wx' })
    console.log(JSON.stringify(result))
  } finally { ledger?.close(); entries.close(); await client?.close() }
}
if (require.main === module) main().catch(error => { console.error(JSON.stringify({ event: 'media-disposition-restoration-failed', code: /^[A-Z][A-Z_]{1,100}$/.test(error.message || '') ? error.message : 'MEDIA_DISPOSITION_RESTORATION_FAILED', privateDetailsOmitted: true })); process.exitCode = 1 })
module.exports = { restoreDisposition, CONFIRMATION }
