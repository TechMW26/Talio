#!/usr/bin/env node
'use strict'

// One-way application-dataset preparation. Reads the immutable local snapshot
// and verified cloud descriptors. Never connects to the old database or changes
// production config. App runtime only uses Firestore, not this offline decoder.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { createGunzip } = require('node:zlib')
const { createHash } = require('node:crypto')
const { BSON } = require('bson')
const admin = require('firebase-admin')
const { datasetPolicy, loadCredentials, assertIsolated } = require('./dataset-policy.cjs')
const { randomUUID } = require('node:crypto')
const { readBson, segment, sha256, recordIdentity, mapLimit } = require('./core.cjs')
const { encodeApplicationRecord, decodeApplicationRecord, recordDigest, applicationRecordKey } = require('../../lib/platform/firestoreCodec.cjs')

function applicationValue(value) {
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value) || value instanceof Date || Buffer.isBuffer(value)) return value
  if (value?._bsontype === 'ObjectId') return value.toHexString()
  if (value?._bsontype === 'Binary') return Buffer.from(value.value(true))
  if (['Long', 'Decimal128'].includes(value?._bsontype)) return value.toString()
  if (Array.isArray(value)) return value.map(applicationValue)
  if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, applicationValue(child)]))
  throw new Error(`Explicit application schema required for ${value?._bsontype || typeof value}`)
}

async function* records(dir, item) {
  const stream = fs.createReadStream(path.join(dir, item.file)).pipe(createGunzip())
  try { yield* readBson(stream) } finally { stream.destroy() }
}

async function main() {
  process.umask(0o077)
  const [command, run, dataset, ...flags] = process.argv.slice(2)
  if (!['check', 'copy', 'verify'].includes(command) || !/^[a-z][a-z0-9-]{7,79}$/.test(run || '') || flags.some(flag => flag !== '--production-candidate')) throw new Error('Usage: materialize.cjs check|copy|verify <run> <dataset> [--production-candidate]')
  const policy = datasetPolicy(dataset, flags.includes('--production-candidate'))
  const root = path.resolve(__dirname, '../..'), dir = path.join(root, '.migration-data', run)
  const manifestBytes = await fsp.readFile(path.join(dir, 'manifest.json'))
  const manifest = JSON.parse(manifestBytes)
  const verification = JSON.parse(await fsp.readFile(path.join(dir, 'verification.json')))
  const journaledCandidate = flags.includes('--production-candidate') && manifest.consistency === 'mongo-per-collection-snapshot-with-change-journal' && typeof manifest.changeJournalStartedAt === 'string' && Number.isFinite(Date.parse(manifest.changeJournalStartedAt))
  if (!manifest.complete || manifest.run !== run || manifest.targetProject !== 'talio-hrms' || !verification.complete || (manifest.consistency !== 'mongo-read-only-snapshot-session' && !journaledCandidate)) throw new Error('A verified consistent source snapshot or journaled production candidate is required')
  const manifestHash = sha256(manifestBytes)
  const report = { version: 1, run, dataset, manifestHash, consistency: manifest.consistency, requiresDeltaReconciliation: Boolean(journaledCandidate), command, complete: false, applicationCutover: false, records: 0, fragmentedRecords: 0, fragments: 0, mediaDescriptors: 0, collections: [] }
  let app, db, target, source
  try {
    if (command !== 'check') {
      if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Cloud materialization must not inherit emulator settings')
      app = admin.initializeApp({ projectId: manifest.targetProject, credential: admin.credential.cert(loadCredentials(root)) }, `materialize-${Date.now()}`)
      db = app.firestore()
      source = db.collection('migrationRuns').doc(run)
      const sourceSnapshot = await source.get()
      if (sourceSnapshot.get('status') !== 'independently-verified-staging-copy' || sourceSnapshot.get('manifestHash') !== manifestHash) throw new Error('Cloud snapshot is not independently verified')
      target = db.collection('talioDatasets').doc(dataset)
      const existing = await target.get()
      if (existing.exists && (existing.get('manifestHash') !== manifestHash || existing.get('sourceRun') !== run || existing.get('applicationCutover') !== false)) throw new Error('Refusing to overwrite a different or active dataset')
      if (existing.exists) assertIsolated(existing.data(), policy)
      if (!existing.exists) {
        if (command === 'verify') throw new Error('Dataset does not exist')
        await target.create({ version: 1, sourceRun: run, manifestHash, consistency: manifest.consistency, requiresDeltaReconciliation: Boolean(journaledCandidate), applicationCutover: false, purpose: policy.purpose, status: 'materializing', createdAt: new Date(), tenants: manifest.tenants })
      }
      await target.update({ nativeVerificationRevision: randomUUID(), nativeAcceptance: null })
    }
    for (const item of manifest.collections.filter(c => !c.collection.endsWith('.chunks'))) {
      const result = { database: item.database, collection: item.collection, records: 0, fragmentedRecords: 0, fragments: 0, mediaDescriptors: 0 }
      const sourceHash = createHash('sha256'), ids = new Set()
      const base = target?.collection('databases').doc(item.database).collection('collections').doc(item.collection)
      const sourceBase = source?.collection('databases').doc(segment(item.database)).collection('collections').doc(segment(item.collection))
      let batch = []
      async function flush() {
        if (!batch.length) return
        const values = batch; batch = []
        if (command === 'check') return
        const references = values.map(value => base.collection('records').doc(value.key))
        const [existingRecords, sourceMedia] = await Promise.all([
          db.getAll(...references),
          item.collection.endsWith('.files') ? db.getAll(...values.map(value => sourceBase.collection('records').doc(value.sourceKey))) : [],
        ])
        let write = db.batch(), pendingCount = 0, pendingBytes = 0
        const commit = async () => {
          if (pendingCount) {
            assertIsolated((await target.get()).data(), policy)
            await write.commit()
          }
          write = db.batch(); pendingCount = 0; pendingBytes = 0
        }
        for (let index = 0; index < values.length; index++) {
          const { rawHash, record, encoded } = values[index]
          const reference = references[index], existing = existingRecords[index]
          let media = null
          if (item.collection.endsWith('.files')) {
            media = sourceMedia[index].get('media')
            if (!media || media.access !== 'private' || media.database !== item.database || media.bucket !== item.collection.slice(0, -6)) throw new Error('Verified private media descriptor is required')
            result.mediaDescriptors++
          }
          const digest = recordDigest(record)
          if (command === 'copy' && !existing.exists) {
            const bytes = Buffer.byteLength(JSON.stringify(encoded.envelope)) + encoded.parts.reduce((sum, part) => sum + part.value.bytes.length, 0)
            if (pendingCount + 1 + encoded.parts.length > 400 || pendingBytes + bytes > 8 * 1024 * 1024) await commit()
            write.create(reference, { ...encoded.envelope, digest, sourceSha256: rawHash, ...(media ? { media } : {}) })
            for (const part of encoded.parts) write.create(reference.collection('parts').doc(part.id), part.value)
            pendingCount += 1 + encoded.parts.length; pendingBytes += bytes
          } else {
            if (!existing.exists || existing.get('sourceSha256') !== rawHash || existing.get('digest') !== digest) throw new Error('Application record conflict or missing record')
            const parts = encoded.parts.length ? await db.getAll(...encoded.parts.map(part => reference.collection('parts').doc(part.id))) : []
            const actual = decodeApplicationRecord(existing.data(), new Map(parts.filter(p => p.exists).map(p => [p.id, p.data()])))
            if (recordDigest(actual) !== digest) throw new Error('Application record round-trip mismatch')
            if (media && recordDigest(existing.get('media')) !== recordDigest(media)) throw new Error('Application media descriptor mismatch')
          }
        }
        await commit()
      }
      for await (const raw of records(dir, item)) {
        sourceHash.update(raw)
        const record = applicationValue(BSON.deserialize(raw))
        if (typeof record._id !== 'string') throw new Error('Explicit record ID conversion required')
        const key = applicationRecordKey(record._id)
        if (ids.has(key)) throw new Error('Application record ID collision')
        ids.add(key)
        const encoded = encodeApplicationRecord(record)
        const decoded = decodeApplicationRecord(encoded.envelope, new Map(encoded.parts.map(part => [part.id, part.value])))
        if (recordDigest(record) !== recordDigest(decoded)) throw new Error('Local application round-trip failed')
        result.records++; result.fragments += encoded.parts.length
        if (encoded.parts.length) result.fragmentedRecords++
        batch.push({ key, rawHash: sha256(raw), record, encoded, sourceKey: recordIdentity(raw).key })
        if (batch.length === 64) await flush()
      }
      await flush()
      if (result.records !== item.count || sourceHash.digest('hex') !== item.sha256) throw new Error('Source snapshot checksum/count changed')
      if (command === 'copy') await base.set({ sourceRun: run, count: item.count, sourceSha256: item.sha256, sourceIndexesEjson: item.indexesEjson, status: 'materialized' })
      if (command === 'verify' && (await base.collection('records').count().get()).data().count !== item.count) throw new Error('Application collection count mismatch')
      report.collections.push(result)
      for (const key of ['records', 'fragmentedRecords', 'fragments', 'mediaDescriptors']) report[key] += result[key]
      console.log(JSON.stringify({ event: `native-${command}-collection`, ...result }))
    }
    report.complete = true; report.finishedAt = new Date().toISOString()
    await fsp.writeFile(path.join(dir, `${dataset}-${command}.json`), JSON.stringify(report, null, 2), { mode: 0o600 })
    if (target) await db.runTransaction(async tx => {
      assertIsolated((await tx.get(target)).data(), policy)
      tx.update(target, { status: command === 'verify' ? policy.verifiedStatus : 'materialized-awaiting-verification', records: report.records, fragmentedRecords: report.fragmentedRecords, fragments: report.fragments, mediaDescriptors: report.mediaDescriptors, updatedAt: new Date() })
    })
    console.log(JSON.stringify({ event: `native-${command}-complete`, records: report.records, fragmentedRecords: report.fragmentedRecords, fragments: report.fragments, mediaDescriptors: report.mediaDescriptors }))
  } finally { if (db) await db.terminate(); if (app) await app.delete() }
}

if (require.main === module) main().catch(error => { console.error(JSON.stringify({ event: 'native-dataset-failed', code: error.code || null, message: String(error.message).replace(/https?:\/\/\S+/g, '[URL]') })); process.exitCode = 1 })
module.exports = { applicationValue }
