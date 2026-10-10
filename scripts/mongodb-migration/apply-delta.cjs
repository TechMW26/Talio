#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const dotenv = require('dotenv')
const { BSON } = require('bson')
const { gzipSync } = require('node:zlib')
const { createHash } = require('node:crypto')
const { loadIndexedEntries, resolveSharedArchiveDocuments, sourceCollectionsHash } = require('./migrate.cjs')
const { targetDocuments } = require('./reconcile.cjs')
const { sha256, canonical, archiveDocument, decodeArchiveDocument, assertSameSource, assertTarget } = require('./core.cjs')

const hashDocument = document => document ? sha256(canonical(document)) : null
const validRun = run => typeof run === 'string' && /^[a-z][a-z0-9-]{7,79}$/.test(run)
const normalizeDatasets = datasets => {
  if (!Array.isArray(datasets) || !datasets.length || datasets.some(value => !/^[a-z][a-z0-9-]{7,79}$/.test(value))) throw new Error('EXPLICIT_DATASET_ALLOWLIST_REQUIRED')
  return [...new Set(datasets)].sort()
}

function* iterateDeltaOperations(before, after, baselineRun, candidateRun, datasets) {
  // Every final source document has a candidate ledger entry. Unchanged raw
  // payloads reference the immutable baseline bytes instead of duplicating GBs.
  for (const documentPath of [...after.keys()].sort((a, b) => a.localeCompare(b))) {
    const entry = after.get(documentPath)
    const unchanged = before.has(documentPath) && canonical(before.get(documentPath)) === canonical(entry)
    const document = unchanged ? {
      _id: sha256(JSON.stringify([candidateRun, documentPath])), run: candidateRun, path: documentPath,
      exists: entry.exists, sha256: entry.sha256, codec: 'firestore-proto-pack-gzip-v1',
      payloadSha256: sha256(canonical(entry)), sharedPayloadFrom: sha256(JSON.stringify([baselineRun, documentPath])), sharedPayloadRun: baselineRun,
    } : archiveDocument(entry, candidateRun)
    yield { bank: 'talio_firestore_archive', id: document._id, action: 'insert', beforeHash: null, afterHash: hashDocument(document), document, ...(unchanged ? { baselineEntry: entry } : {}) }
  }
  const beforeDocuments = targetDocuments(before, datasets), afterDocuments = targetDocuments(after, datasets)
  for (const key of [...new Set([...beforeDocuments.keys(), ...afterDocuments.keys()])].sort()) {
    const previous = beforeDocuments.get(key), current = afterDocuments.get(key)
    const beforeHash = hashDocument(previous?.document), afterHash = hashDocument(current?.document)
    if (beforeHash === afterHash) continue
    yield { bank: (current || previous).bank, id: (current || previous).document._id, action: !previous ? 'insert' : !current ? 'removeFromLiveBank' : 'replace', beforeHash, afterHash, beforeBytes: previous ? BSON.calculateObjectSize(previous.document) : 0, document: current?.document || null }
  }
}

// Small-fixture compatibility; the live runner never collects payloads here.
function buildDeltaOperations(...args) { return [...iterateDeltaOperations(...args)] }

function* iterateBoundedBatches(operations, maxWrites = 64, maxBytes = 8 * 1024 * 1024) {
  if (!Number.isInteger(maxWrites) || maxWrites < 1 || maxWrites > 100 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) throw new Error('INVALID_DELTA_BATCH_BOUND')
  let batch = [], bytes = 0
  for (const operation of operations) {
    const documentBytes = operation.document ? BSON.calculateObjectSize(operation.document) : 0
    // Recovery journals must also be bounded when a large old record is replaced
    // by a small new record. Include journal metadata, not only outgoing writes.
    const length = Math.max(documentBytes, operation.beforeBytes || 0) + 512
    if (length > maxBytes || Math.max(documentBytes, operation.beforeBytes || 0) > 15 * 1024 * 1024) throw new Error('DELTA_DOCUMENT_EXCEEDS_BATCH_BOUND')
    // Shared aliases still carry baselineEntry for exact payload verification.
    // Account for its memory as well as the actual transaction BSON bound.
    const retained = operation.baselineEntry ? Buffer.byteLength(canonical(operation.baselineEntry)) : 0
    const memoryLength = Math.max(length, retained + 512)
    if (memoryLength > maxBytes) throw new Error('DELTA_DOCUMENT_EXCEEDS_BATCH_BOUND')
    if (batch.length && (batch.length === maxWrites || bytes + memoryLength > maxBytes)) { yield batch; batch = []; bytes = 0 }
    batch.push(operation); bytes += memoryLength
  }
  if (batch.length) yield batch
}

function boundedBatches(...args) { return [...iterateBoundedBatches(...args)] }

function summarizeDeltaOperations(makeOperations, maxWrites, maxBytes) {
  // canonical() encodes arrays as ["array",[...]]. Streaming exactly the same
  // bytes keeps existing checkpoint identities compatible without huge arrays.
  const empty = canonical([]), hash = createHash('sha256')
  hash.update(empty.slice(0, -2))
  let operations = 0, batches = 0
  for (const batch of iterateBoundedBatches(makeOperations(), maxWrites, maxBytes)) {
    batches++
    for (const { bank, id, action, beforeHash, afterHash } of batch) {
      if (operations) hash.update(',')
      hash.update(canonical({ bank, id, action, beforeHash, afterHash })); operations++
    }
  }
  hash.update(']]')
  return { operationsHash: hash.digest('hex'), operations, batches }
}

async function assertFence(db, context, session) {
  const options = session ? { session } : {}
  const fence = await db.collection('talio_migration_controls').findOne({ _id: 'write-fence' }, options)
  const expiresAt = fence?.expiresAt === undefined ? null : new Date(fence.expiresAt).getTime()
  if (!fence || fence.active !== true || fence.baselineRun !== context.baselineRun || fence.candidateRun !== context.candidateRun || canonical(normalizeDatasets(fence.datasets)) !== canonical(context.datasets) || (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now()))) throw new Error('EXACT_ACTIVE_TARGET_WRITE_FENCE_REQUIRED')
  const catalogs = await db.collection('talio_catalogs').find({ _id: { $in: context.datasets } }, options).toArray()
  if (catalogs.length !== context.datasets.length || catalogs.some(catalog => catalog.applicationCutover !== false || catalog.mongoVerified !== false)) throw new Error('TARGET_CATALOG_MUST_REMAIN_UNVERIFIED_AND_NON_WRITABLE')
}

async function preserveBeforeImage(recoveryDir, context, batch, actual, checkpointId) {
  await fsp.mkdir(recoveryDir, { recursive: true, mode: 0o700 })
  await fsp.chmod(recoveryDir, 0o700)
  const file = path.join(recoveryDir, `${checkpointId}.bson.gz`)
  const value = { version: 1, baselineRun: context.baselineRun, candidateRun: context.candidateRun, planHash: context.planHash, operations: batch.map(operation => ({ bank: operation.bank, id: operation.id, beforeHash: operation.beforeHash, afterHash: operation.afterHash, before: actual.get(`${operation.bank}/${operation.id}`) || null })) }
  const bytes = gzipSync(BSON.serialize(value))
  try {
    await fsp.access(file)
    if (!Buffer.from(await fsp.readFile(file)).equals(bytes)) throw new Error('PRIVATE_BEFORE_IMAGE_CONFLICT')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
    await fsp.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
    // Atomic publication prevents a terminated process leaving a half-written
    // authoritative before-image. The private temporary hard link is retained.
    try { await fsp.link(temporary, file) } catch (linkError) {
      if (linkError.code !== 'EEXIST') throw linkError
      if (!Buffer.from(await fsp.readFile(file)).equals(bytes)) throw new Error('PRIVATE_BEFORE_IMAGE_CONFLICT')
    }
  }
  return { id: checkpointId, beforeImageSha256: sha256(bytes), operations: batch.length }
}

async function applyDelta({ db, client, before, after, baselineRun, candidateRun, datasets, recoveryDir, baselineManifestHash, candidateManifestHash, maxWrites = 64, maxBytes = 8 * 1024 * 1024 }) {
  if (!validRun(baselineRun) || !validRun(candidateRun) || baselineRun === candidateRun || !client?.startSession || typeof recoveryDir !== 'string') throw new Error('EXPLICIT_DELTA_CONTEXT_REQUIRED')
  datasets = normalizeDatasets(datasets)
  if (!/^[a-f0-9]{64}$/.test(baselineManifestHash || '') || !/^[a-f0-9]{64}$/.test(candidateManifestHash || '')) throw new Error('EXACT_MANIFEST_HASHES_REQUIRED')
  const makeOperations = () => iterateDeltaOperations(before, after, baselineRun, candidateRun, datasets)
  const summary = summarizeDeltaOperations(makeOperations, maxWrites, maxBytes)
  before.assertUnchanged?.(); after.assertUnchanged?.()
  const operationsHash = summary.operationsHash
  const context = { baselineRun, candidateRun, datasets, planHash: sha256(canonical([baselineRun, candidateRun, datasets, baselineManifestHash, candidateManifestHash, operationsHash, maxWrites, maxBytes, 'bounded-memory-v2'])) }
  await assertFence(db, context)
  const runs = db.collection('talio_migration_delta_runs'), checkpoints = db.collection('talio_migration_delta_batches')
  const marker = await runs.findOne({ _id: candidateRun })
  if (marker && marker.planHash !== context.planHash) throw new Error('DELTA_RUN_CONFLICT')
  await runs.updateOne({ _id: candidateRun }, { $setOnInsert: { ...context, status: 'applying', startedAt: new Date(), batches: summary.batches } }, { upsert: true })
  let applied = 0, resumed = 0, index = 0, observedOperations = 0
  for (const batch of iterateBoundedBatches(makeOperations(), maxWrites, maxBytes)) {
    const checkpointId = sha256(canonical([context.planHash, index]))
    const session = client.startSession()
    try {
      const result = await session.withTransaction(async () => {
        await assertFence(db, context, session)
        // Touch the fence in this transaction so releasing it concurrently
        // conflicts/retries instead of allowing a snapshot-isolation write skew.
        const lock = await db.collection('talio_migration_controls').updateOne({ _id: 'write-fence', active: true, baselineRun, candidateRun }, { $set: { lastDeltaBatch: checkpointId } }, { session })
        if (lock.matchedCount !== 1) throw new Error('TARGET_WRITE_FENCE_RELEASED')
        const checkpoint = await checkpoints.findOne({ _id: checkpointId }, { session })
        const actual = new Map()
        for (const bank of [...new Set(batch.map(item => item.bank))]) {
          const ids = batch.filter(item => item.bank === bank).map(item => item.id)
          const documents = await db.collection(bank).find({ _id: { $in: ids } }, { session }).toArray()
          for (const document of documents) actual.set(`${bank}/${document._id}`, document)
        }
        if (checkpoint) {
          if (checkpoint.planHash !== context.planHash || checkpoint.complete !== true) throw new Error('DELTA_CHECKPOINT_CONFLICT')
          for (const operation of batch) if (hashDocument(actual.get(`${operation.bank}/${operation.id}`)) !== operation.afterHash) throw new Error('TARGET_CHANGED_AFTER_DELTA_CHECKPOINT')
          return 'resumed'
        }
        // Verify every optimistic precondition before staging ANY data mutation.
        for (const operation of batch) if (hashDocument(actual.get(`${operation.bank}/${operation.id}`)) !== operation.beforeHash) throw new Error('TARGET_OPTIMISTIC_BEFORE_HASH_MISMATCH')
        const shared = batch.filter(item => item.baselineEntry)
        if (shared.length) {
          const originals = await db.collection('talio_firestore_archive').find({ _id: { $in: shared.map(item => item.document.sharedPayloadFrom) } }, { session }).toArray()
          const resolved = new Map((await resolveSharedArchiveDocuments(db.collection('talio_firestore_archive'), originals, { session })).map(doc => [doc._id, doc]))
          for (const operation of shared) {
            const original = resolved.get(operation.document.sharedPayloadFrom)
            if (!original) throw new Error('BASELINE_ARCHIVE_PAYLOAD_MISSING')
            assertSameSource(operation.baselineEntry, decodeArchiveDocument(original))
            if (original.payloadSha256 !== operation.document.payloadSha256) throw new Error('BASELINE_ARCHIVE_PAYLOAD_HASH_MISMATCH')
          }
        }
        const recovery = await preserveBeforeImage(recoveryDir, context, batch, actual, checkpointId)
        for (const bank of [...new Set(batch.map(item => item.bank))]) {
          const items = batch.filter(item => item.bank === bank)
          const writes = items.map(operation => operation.action === 'removeFromLiveBank' ? { deleteOne: { filter: { _id: operation.id } } } : operation.beforeHash === null ? { insertOne: { document: operation.document } } : { replaceOne: { filter: { _id: operation.id }, replacement: operation.document } })
          const result = await db.collection(bank).bulkWrite(writes, { session, ordered: true })
          if (result.deletedCount !== items.filter(item => item.action === 'removeFromLiveBank').length || result.matchedCount !== items.filter(item => item.beforeHash !== null && item.action !== 'removeFromLiveBank').length || result.insertedCount !== items.filter(item => item.beforeHash === null).length) throw new Error('TARGET_DELTA_BULK_RESULT_MISMATCH')
        }
        await checkpoints.insertOne({ _id: checkpointId, ...context, index, complete: true, operations: batch.length, recovery, finishedAt: new Date() }, { session })
        return 'applied'
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 30000 })
      if (result === 'resumed') resumed++; else applied++
    } finally { await session.endSession() }
    observedOperations += batch.length; index++
    console.log(JSON.stringify({ event: 'mongo-delta-batch-complete', batch: index, batches: summary.batches, applied, resumed, operations: batch.length }))
  }
  if (index !== summary.batches || observedOperations !== summary.operations) throw new Error('DELTA_ITERATION_CHANGED_AFTER_PLAN')
  before.assertUnchanged?.(); after.assertUnchanged?.()
  await assertFence(db, context)
  await runs.updateOne({ _id: candidateRun, planHash: context.planHash }, { $set: { status: 'applied-awaiting-full-parity-verification', appliedBatches: applied, resumedBatches: resumed, finishedAt: new Date() } })
  return { candidateRun, batches: summary.batches, applied, resumed, operations: summary.operations, targetWritesPerformed: true, mongoVerified: false, applicationCutover: false, fullVerificationRequired: true }
}

async function main() {
  process.umask(0o077)
  const [baselineRun, candidateRun, ...args] = process.argv.slice(2)
  if (!validRun(baselineRun) || !validRun(candidateRun)) throw new Error('Usage: apply-delta.cjs <baselineRun> <candidateRun> --host=HOST --database=DATABASE --datasets=LOCAL,LIVE')
  const flags = Object.fromEntries(args.map(arg => { const match = /^--(host|database|datasets)=([^=]+)$/.exec(arg); if (!match) throw new Error('INVALID_DELTA_FLAG'); return [match[1], match[2]] }))
  const root = path.resolve(__dirname, '../..')
  const readEnv = file => fs.existsSync(path.join(root, file)) ? dotenv.parse(fs.readFileSync(path.join(root, file))) : {}
  const env = { ...readEnv('.env'), ...readEnv('.env.local'), ...process.env }
  const databaseName = env.MONGODB_DATABASE || 'talio'
  assertTarget(env.MONGODB_URI, databaseName, flags.host, flags.database)
  const datasets = normalizeDatasets((flags.datasets || '').split(','))
  const baselineDir = path.join(root, '.migration-data', baselineRun), candidateDir = path.join(root, '.migration-data', candidateRun)
  const baselineBytes = await fsp.readFile(path.join(baselineDir, 'manifest.json')), candidateBytes = await fsp.readFile(path.join(candidateDir, 'manifest.json'))
  const baseline = JSON.parse(baselineBytes), candidate = JSON.parse(candidateBytes)
  const verification = JSON.parse(await fsp.readFile(path.join(candidateDir, 'source-verification.json')))
  const verifiedAt = Date.parse(verification.verifiedAt), exportedAt = Date.parse(candidate.exportFinishedAt)
  const expectedSourceHash = verification.sourceHashVersion === 'canonical-sorted-collections-v1' ? sourceCollectionsHash(candidate.collections) : verification.sourceHashVersion === undefined ? sha256(JSON.stringify(candidate.collections)) : null
  if (!baseline.complete || !candidate.complete || baseline.run !== baselineRun || candidate.run !== candidateRun || candidate.sourceBaselineRun !== baselineRun || candidate.sourceBaselineManifestHash !== sha256(baselineBytes) || canonical(normalizeDatasets(candidate.datasets)) !== canonical(datasets) || verification.run !== candidateRun || verification.complete !== true || verification.unchangedAtRead !== true || verification.sourceHash !== expectedSourceHash || !Number.isFinite(verifiedAt) || !Number.isFinite(exportedAt) || verifiedAt < exportedAt) throw new Error('EXACT_FROZEN_SOURCE_CANDIDATE_VERIFICATION_REQUIRED')
  const before = await loadIndexedEntries(baselineDir, baseline)
  let after
  let client
  try {
    const { MongoClient } = require('mongodb')
    client = new MongoClient(env.MONGODB_URI, { maxPoolSize: 4, promoteBuffers: true, serverSelectionTimeoutMS: 15000 })
    after = await loadIndexedEntries(candidateDir, candidate)
    await client.connect()
    const report = await applyDelta({ db: client.db(databaseName), client, before, after, baselineRun, candidateRun, datasets, recoveryDir: path.join(candidateDir, 'mongo-before-images'), baselineManifestHash: sha256(baselineBytes), candidateManifestHash: sha256(candidateBytes), maxWrites: Number(env.MONGODB_DELTA_BATCH_WRITES || 64) })
    await fsp.writeFile(path.join(candidateDir, 'mongo-delta-application.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
    console.log(JSON.stringify({ event: 'mongo-delta-application-complete', ...report }))
  } finally { before.close(); after?.close(); await client?.close() }
}

if (require.main === module) main().catch(error => { console.error(JSON.stringify({ event: 'delta-application-failed', code: error.code || null, message: String(error.message).replace(/(?:mongodb(?:\+srv)?|https?):\/\/\S+/g, '[REDACTED_URI]') })); process.exitCode = 1 })
module.exports = { buildDeltaOperations, iterateDeltaOperations, boundedBatches, iterateBoundedBatches, summarizeDeltaOperations, assertFence, applyDelta, preserveBeforeImage }
