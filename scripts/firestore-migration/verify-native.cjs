'use strict'

// Read-only independent acceptance audit against the immutable BSON snapshot.
// Only named, deterministic query projections, verified Blob extraction, and
// uniquely owner-routed AI history copies may differ from the source records.
const fs = require('node:fs')
const path = require('node:path')
const { createGunzip } = require('node:zlib')
const { createHash } = require('node:crypto')
const dotenv = require('dotenv')
const { BSON } = require('bson')
const { initializeApp, cert, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { get: getBlob } = require('@vercel/blob')
const { readBson, sha256, mapLimit } = require('./core.cjs')
const { applicationValue } = require('./materialize.cjs')
const { applicationRecordKey, decodeApplicationRecord, partIds, recordDigest } = require('../../lib/platform/firestoreCodec.cjs')
const { projectNativeRecord } = require('../../lib/platform/searchProjection.cjs')
const { datasetPolicy, loadCredentials, assertIsolated } = require('./dataset-policy.cjs')
const EXCLUDED_SCREENSHOT_COLLECTIONS = new Set(['screenshots', 'screenshots.files', 'screenshots.chunks', 'screenshotanalyses', 'screenshotcomposites'])

async function* sourceRecords(directory, item) {
  const stream = fs.createReadStream(path.join(directory, item.file)).pipe(createGunzip())
  try { yield* readBson(stream) } finally { stream.destroy() }
}

// Enumerate every collection as before, but bound independent metadata RPCs.
// Return results in source order so audit reports remain deterministic.
async function readActualCollectionCounts(root) {
  const databases = await root.collection('databases').listDocuments()
  const groups = await mapLimit(databases, 4, async database => {
    const parents = await database.collection('collections').listDocuments()
    return parents.map(parent => ({ database: database.id, parent }))
  })
  return mapLimit(groups.flat(), 16, async ({ database, parent }) => ({
    database,
    collection: parent.id,
    count: (await parent.collection('records').count().get()).data().count,
  }))
}

// Only top-level field names are reported. Nested keys can themselves contain
// user-entered values, so never serialize changed values or object/array paths.
function changedFieldNames(expected, actual) {
  return [...new Set([...Object.keys(expected || {}), ...Object.keys(actual || {})])]
    .filter(field => Object.hasOwn(expected || {}, field) !== Object.hasOwn(actual || {}, field) || recordDigest(expected?.[field]) !== recordDigest(actual?.[field]))
    .map(field => /^[A-Za-z_][A-Za-z0-9_]{0,119}$/.test(field) ? field : `field-sha256-${sha256(field)}`)
    .sort()
}

function recordDifference({ database, collection, recordId, expected, actual, expectedSourceHash, actualSourceHash, checkSource = true, issues = [] }) {
  const fields = changedFieldNames(expected, actual)
  const sourceProvenanceChanged = checkSource && actualSourceHash !== expectedSourceHash
  const sourceProvenanceMissing = checkSource && !actualSourceHash
  const reasons = [...issues, ...(fields.length ? ['business_values_changed'] : []), ...(sourceProvenanceChanged ? ['source_provenance_changed'] : [])]
  if (!reasons.length) return null
  return { database, collection, recordIdentifierHash: sha256(JSON.stringify([database, collection, String(recordId)])), fields, sourceProvenanceChanged, sourceProvenanceMissing, issues: [...new Set(reasons)].sort() }
}

function recordComparison(report, difference, reportDifferences, routed = false) {
  const compared = routed ? 'routedHistoriesCompared' : 'recordsCompared'
  const verified = routed ? 'routedHistories' : 'recordsVerified'
  report[compared]++
  if (!difference) { report[verified]++; return }
  if (!reportDifferences) throw new Error(`Native verification mismatch in ${difference.database}/${difference.collection}: ${difference.issues.join(',')}`)
  report.differences.push({ ...difference, ...(routed ? { routedHistory: true } : {}) })
}

function writeReport(directory, dataset, report, reportDifferences) {
  report.complete = true
  report.passed = report.differences.length === 0 && report.countDifferences.length === 0
  report.finishedAt = new Date().toISOString()
  const filename = reportDifferences
    ? `${dataset}-native-differences-${report.finishedAt.replace(/[^\d]/g, '')}.json`
    : `${dataset}-native-acceptance.json`
  // Report mode always creates a separate report, never replaces acceptance.
  fs.writeFileSync(path.join(directory, filename), JSON.stringify(report, null, 2), { mode: 0o600, ...(reportDifferences ? { flag: 'wx' } : {}) })
  return filename
}
async function run() {
  process.umask(0o077)
  const [runId, dataset, ...flags] = process.argv.slice(2)
  if (flags.some(flag => !['--report-differences', '--production-candidate'].includes(flag)) || new Set(flags).size !== flags.length) throw new Error('Unsupported audit option')
  const reportDifferences = flags.includes('--report-differences')
  const policy = datasetPolicy(dataset, flags.includes('--production-candidate'))
  if (!/^[a-z][a-z0-9-]{7,79}$/.test(runId || '')) throw new Error('Explicit cloud archive and isolated dataset required')
  const directory = path.resolve('.migration-data', runId)
  const manifestBytes = fs.readFileSync(path.join(directory, 'manifest.json'))
  const manifest = JSON.parse(manifestBytes)
  const sourceVerification = JSON.parse(fs.readFileSync(path.join(directory, 'verification.json')))
  if (!manifest.complete || manifest.run !== runId || manifest.targetProject !== 'talio-hrms' || !sourceVerification.complete) throw new Error('Verified immutable source is required')
  const app = initializeApp({ projectId: 'talio-hrms', credential: cert(loadCredentials()) }, `native-audit-${Date.now()}`)
  const firestore = getFirestore(app)
    const report = { version: 2, mode: reportDifferences ? 'report-differences' : 'strict', dataset, sourceRun: runId, complete: false, passed: false, excludedCollections: [...EXCLUDED_SCREENSHOT_COLLECTIONS], recordsCompared: 0, recordsVerified: 0, projectedRecords: 0, extractedMedia: 0, blobBytesVerified: 0, routedHistoriesCompared: 0, routedHistories: 0, differences: [], countDifferences: [], collections: [] }
  try {
    const root = firestore.collection('talioDatasets').doc(dataset), catalog = (await root.get()).data()
    assertIsolated(catalog, policy, true)
    if (catalog?.manifestHash !== sha256(manifestBytes) || catalog?.sourceRun !== runId) throw new Error('Dataset provenance or isolation mismatch')
    report.purpose = policy.purpose
    report.consistency = manifest.consistency
    report.requiresDeltaReconciliation = manifest.consistency === 'mongo-per-collection-snapshot-with-change-journal'
    report.manifestHash = catalog.manifestHash
    report.verificationRevision = catalog.nativeVerificationRevision || null
    report.startedAt = new Date().toISOString()
    const tenants = new Set(catalog.tenants.map(tenant => tenant.databaseName))
    const collection = (db, name) => root.collection('databases').doc(db).collection('collections').doc(name).collection('records')
    async function decode(snapshot) {
      if (!snapshot.exists) throw new Error('Missing native record')
      const ids = partIds(snapshot.data()), parts = ids.length ? await firestore.getAll(...ids.map(id => snapshot.ref.collection('parts').doc(id))) : []
      return decodeApplicationRecord(snapshot.data(), new Map(parts.map(part => [part.id, part.data()])))
    }
    // Build ownership from the SOURCE, not mutable tenant application records.
    const sourceUserOwners = new Map()
    for (const item of manifest.collections.filter(item => tenants.has(item.database) && item.collection === 'users')) {
      for await (const raw of sourceRecords(directory, item)) {
        const user = applicationValue(BSON.deserialize(raw)), owners = sourceUserOwners.get(user._id) || []
        owners.push(item.database); sourceUserOwners.set(user._id, owners)
      }
    }
    const expectedCounts = new Map(), histories = []
    for (const item of manifest.collections.filter(item => !item.collection.endsWith('.chunks') && !EXCLUDED_SCREENSHOT_COLLECTIONS.has(item.collection))) {
      const key = `${item.database}/${item.collection}`
      expectedCounts.set(key, item.count)
      const hash = createHash('sha256')
      let count = 0, batch = []
      const comparedBefore = report.recordsCompared, verifiedBefore = report.recordsVerified
      async function flush() {
        if (!batch.length) return
        const values = batch; batch = []
        const snapshots = await firestore.getAll(...values.map(value => collection(item.database, item.collection).doc(applicationRecordKey(value.record._id))))
        await Promise.all(values.map(async ({ record, rawHash }, index) => {
          const snapshot = snapshots[index], issues = []
          let actual = null
          if (!snapshot.exists) issues.push('record_missing')
          else {
            try { actual = await decode(snapshot) } catch (error) {
              if (!reportDifferences) throw error
              // Corrupt envelopes/parts are a semantic difference. Provider
              // outages remain fatal rather than claiming a completed audit.
              if (error.code) throw error
              issues.push('record_decode_failed')
            }
          }
          let expected = tenants.has(item.database) ? projectNativeRecord(item.collection, record) : record
          if (recordDigest(expected) !== recordDigest(record)) report.projectedRecords++
          if (item.collection === 'mirageneratedimages' && Buffer.isBuffer(record.imageBuffer) && record.imageBuffer.length) {
            const { imageBuffer, ...fields } = expected
            const digest = sha256(imageBuffer)
            const pathname = `tenants/${item.database}/mira-images/${record.user}/migrated-${record._id}-${digest}.png`
            if (!(actual?.embeddedMediaMigratedAt instanceof Date) || !Number.isFinite(actual.embeddedMediaMigratedAt.getTime())) issues.push('media_provenance_missing')
            expected = { ...fields, pathname, sha256: digest, byteLength: imageBuffer.length, contentType: record.contentType || 'image/png', embeddedMediaMigratedAt: actual?.embeddedMediaMigratedAt }
            const token = dotenv.parse(fs.readFileSync('.vercel/.env.migration-source.local')).BLOB_READ_WRITE_TOKEN
            const blob = await getBlob(pathname, { token, access: 'private', useCache: false, abortSignal: AbortSignal.timeout(30000) })
            if (!blob?.stream || blob.statusCode !== 200) issues.push('extracted_blob_unavailable')
            else {
              const bytes = Buffer.from(await new Response(blob.stream).arrayBuffer())
              if (bytes.length !== imageBuffer.length || sha256(bytes) !== digest) issues.push('extracted_blob_bytes_changed')
              else { report.extractedMedia++; report.blobBytesVerified += bytes.length }
            }
          }
          // GridFS byte descriptors were independently verified by run.cjs.
          // Require the original source identity and private access boundary.
          if (item.collection.endsWith('.files')) {
            const media = snapshot.exists ? snapshot.get('media') : null
            if (!media || media.access !== 'private' || media.database !== item.database || media.bucket !== item.collection.slice(0, -6) || media.length !== record.length || !/^[a-f\d]{64}$/.test(media.sha256 || '')) issues.push('private_media_descriptor_changed')
          }
          recordComparison(report, recordDifference({ database: item.database, collection: item.collection, recordId: record._id, expected, actual, expectedSourceHash: rawHash, actualSourceHash: snapshot.exists ? snapshot.get('sourceSha256') : null, checkSource: !(item.collection === 'mirageneratedimages' && Buffer.isBuffer(record.imageBuffer) && record.imageBuffer.length), issues }), reportDifferences)
        }))
      }
      for await (const raw of sourceRecords(directory, item)) {
        hash.update(raw); count++
        const record = applicationValue(BSON.deserialize(raw))
        if (item.database === 'test' && item.collection === 'aicontexts') histories.push(record)
        batch.push({ record, rawHash: sha256(raw) })
        if (batch.length === 100) await flush()
      }
      await flush()
      if (count !== item.count || hash.digest('hex') !== item.sha256) throw new Error('Immutable archive count/checksum changed')
      const result = { database: item.database, collection: item.collection, compared: report.recordsCompared - comparedBefore, verified: report.recordsVerified - verifiedBefore }
      report.collections.push(result)
      console.log(JSON.stringify({ event: 'native-acceptance-collection', ...result }))
    }
    const routedHistoryResults = await mapLimit(histories, 16, async history => {
      const owners = sourceUserOwners.get(String(history.userId)) || []
      if (owners.length !== 1) throw new Error('Shared AI history ownership is unresolved')
      const snapshot = await collection(owners[0], 'aicontexts').doc(applicationRecordKey(history._id)).get()
      const actual = snapshot.exists ? await decode(snapshot) : null
      return { database: owners[0], difference: recordDifference({ database: owners[0], collection: 'aicontexts', recordId: history._id, expected: history, actual, checkSource: false, issues: snapshot.exists ? [] : ['record_missing'] }) }
    })
    for (const result of routedHistoryResults) {
      recordComparison(report, result.difference, reportDifferences, true)
      const key = `${result.database}/aicontexts`
      expectedCounts.set(key, (expectedCounts.get(key) || 0) + 1)
    }
    // Count every actual collection, including new owner-routed collections,
    // so duplicate/unexpected records are not silently hidden by source checks.
    const actualKeys = new Set()
    for (const { database, collection: name, count } of await readActualCollectionCounts(root)) {
      const key = `${database}/${name}`
      if (count !== (expectedCounts.get(key) || 0)) {
        if (!reportDifferences) throw new Error(`Unexpected native count in ${key}`)
        report.countDifferences.push({ database, collection: name, expectedCount: expectedCounts.get(key) || 0, actualCount: count, delta: count - (expectedCounts.get(key) || 0) })
      }
      actualKeys.add(key)
    }
    for (const [key, count] of expectedCounts) if (count && !actualKeys.has(key)) {
      if (!reportDifferences) throw new Error(`Missing native collection ${key}`)
      const [database, collection] = key.split('/')
      report.countDifferences.push({ database, collection, expectedCount: count, actualCount: 0, delta: -count })
    }
    const freshCatalog = (await root.get()).data()
    assertIsolated(freshCatalog, policy, true)
    if ((freshCatalog.nativeVerificationRevision || null) !== report.verificationRevision) throw new Error('Dataset changed during verification; rerun strict verification')
    const filename = writeReport(directory, dataset, report, reportDifferences)
    console.log(JSON.stringify({ event: 'native-acceptance-complete', ...report, differences: report.differences.length, countDifferences: report.countDifferences.length, collections: report.collections.length, reportFile: filename }))
    return report
  } finally { await firestore.terminate(); await deleteApp(app) }
}
if (require.main === module) run().then(report => { if (!report.passed) process.exitCode = 1 }).catch(error => { console.error(JSON.stringify({ event: 'native-acceptance-failed', code: error.code || null, message: String(error.message).replace(/https?:\/\/\S+/g, '[URL]') })); process.exitCode = 1 })
module.exports = { run, changedFieldNames, recordDifference, recordComparison, writeReport, readActualCollectionCounts }
