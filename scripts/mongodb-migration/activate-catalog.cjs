#!/usr/bin/env node
'use strict'

// Offline, explicit activation only. This never releases maintenance, rewrites
// records/tenants/authentication, changes env, or deletes the source/archive.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const dotenv = require('dotenv')
const { sha256, canonical, assertTarget } = require('./core.cjs')
const { loadIndexedEntries, importMongo, planMongo, sourceCollectionsHash, sourceTreeCounts, verifiedSourceEpoch, loadNativeDisposition } = require('./migrate.cjs')
const { collectMediaPlan } = require('./verify-media.cjs')
const { assertFence } = require('./apply-delta.cjs')
const { validateQueueDisposition } = require('./queue-disposition.cjs')
const { validateBlobOrphanTail } = require('./blob-orphan-tail.cjs')
function normalizeDatasets(values) {
  if (!Array.isArray(values) || !values.length || values.some(value => !/^[a-z][a-z0-9-]{7,79}$/.test(value))) throw new Error('EXACT_ACTIVATION_DATASETS_REQUIRED')
  return [...new Set(values)].sort()
}

const SOURCE_WRITER_PLANES = Object.freeze(['web-desktop-mobile-api', 'old-deployments', 'socket-io', 'electron-telemetry', 'attendance-bridge-integrations-webhooks', 'cron-queue-workers', 'blob-uploads-tokens-variants', 'email-notification-side-effects', 'scripts-admin-consoles', 'firestore-data-principal'])
const validIdentity = value => typeof value === 'string' && /^[a-z][a-z0-9-]{7,79}$/.test(value)
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN

async function readProtectedJson(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('EXPLICIT_ABSOLUTE_EVIDENCE_PATH_REQUIRED')
  // No symlink following or permissive copies containing privileged evidence.
  const handle = await fsp.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) throw new Error('PROTECTED_OWNED_EVIDENCE_FILE_REQUIRED')
    const bytes = await handle.readFile()
    return { value: JSON.parse(bytes), hash: sha256(bytes) }
  } finally { await handle.close() }
}

function validateActivationEvidence({ candidate, candidateManifestHash, source, mongo, media, mediaVerificationReportHash, fence, sourceFenceEvidenceHash, dataset, datasets, target, mediaPlan, counts, disposition, queueDisposition, queueDispositionHash, now = Date.now() }) {
  datasets = normalizeDatasets(datasets)
  const sourceHash = sourceCollectionsHash(candidate.collections)
  const started = time(candidate.startedAt), exported = time(candidate.exportFinishedAt), sourceVerified = time(source.verifiedAt)
  if (!validIdentity(candidate.run) || !validIdentity(candidate.sourceBaselineRun) || !validHash(candidate.sourceBaselineManifestHash) || typeof candidate.sourceProject !== 'string' || !candidate.sourceProject || typeof candidate.sourceDatabase !== 'string' || !candidate.sourceDatabase || candidate.complete !== true || candidate.sourceVerificationRequired !== true || !datasets.includes(dataset) || !validIdentity(dataset) || canonical(normalizeDatasets(candidate.datasets)) !== canonical(datasets) || !Number.isFinite(started) || !Number.isFinite(exported) || exported < started) throw new Error('COMPLETE_FINAL_CANDIDATE_REQUIRED')
  if (!validHash(candidateManifestHash) || source.run !== candidate.run || source.complete !== true || source.unchangedAtRead !== true || source.sourceHashVersion !== 'canonical-sorted-collections-v1' || source.sourceHash !== sourceHash || !Number.isFinite(sourceVerified) || sourceVerified < exported || sourceVerified > now) throw new Error('BOUND_FROZEN_SOURCE_VERIFICATION_REQUIRED')
  const snapshotExpected = { run: candidate.run, candidateManifestHash, sourceHash, sourceProject: candidate.sourceProject, sourceDatabase: candidate.sourceDatabase, datasets, candidateStartedAt: candidate.startedAt, candidateExportFinishedAt: candidate.exportFinishedAt, sourceCounts: sourceTreeCounts(candidate.collections) }
  const sourceVerificationEpoch = verifiedSourceEpoch(source, snapshotExpected, now), snapshotStarted = time(sourceVerificationEpoch.startedAt)
  const bound = report => report.run === candidate.run && report.sourceHash === sourceHash && report.sourceHashVersion === source.sourceHashVersion && report.candidateManifestHash === candidateManifestHash && canonical(normalizeDatasets(report.datasets)) === canonical(datasets) && Number.isFinite(time(report.verifiedAt)) && time(report.verifiedAt) >= sourceVerified && time(report.verifiedAt) <= now
  if (!bound(mongo) || mongo.verified !== true || canonical(mongo.target) !== canonical(target) || ['rawCount', 'recordCount', 'claimCount', 'catalogCount'].some(key => mongo[key] !== counts[key])) throw new Error('BOUND_SUCCESSFUL_MONGO_PARITY_REPORT_REQUIRED')
  if (disposition) {
    if (disposition.decision !== 'remove-unavailable-media-only' || disposition.userAuthorization !== disposition.decision || disposition.complete !== true || !validHash(disposition.reportHash) || !validHash(disposition.ledgerSha256) || !validHash(disposition.operationsHash) || !validHash(disposition.inventoryReportHash) || !validHash(disposition.inventoryHash) || !validHash(disposition.referenceHash) || disposition.run !== candidate.run || disposition.candidateManifestHash !== candidateManifestHash || disposition.sourceHash !== sourceHash || canonical(disposition.target) !== canonical(target) || canonical(normalizeDatasets(disposition.datasets)) !== canonical(datasets)) throw new Error('EXACT_USER_AUTHORIZED_MEDIA_DISPOSITION_REQUIRED')
    if ([mongo.mediaDisposition, media.mediaDisposition, mediaPlan.report.mediaDisposition, counts.mediaDisposition].some(value => canonical(value) !== canonical(disposition)) || mongo.rawSourceIntegrityUnmodified !== true || counts.rawSourceIntegrityUnmodified !== true || ['sourceRecordCount', 'omittedRecordCount', 'transformedRecordCount'].some(key => !Number.isSafeInteger(mongo[key]) || mongo[key] < 0 || mongo[key] !== counts[key]) || mongo.omittedRecordCount !== disposition.deletedNativeRecords || mongo.transformedRecordCount + mongo.omittedRecordCount !== disposition.changedRecords || mongo.sourceRecordCount !== mongo.recordCount + mongo.omittedRecordCount) throw new Error('BOUND_CLEANED_NATIVE_PARITY_COUNTS_REQUIRED')
  } else if ([mongo.mediaDisposition, media.mediaDisposition, mediaPlan.report.mediaDisposition, counts.mediaDisposition].some(Boolean)) throw new Error('EXPLICIT_MEDIA_DISPOSITION_EVIDENCE_REQUIRED')
  const plan = mediaPlan.report
  if (!bound(media) || media.command !== 'verify' || media.writes !== 0 || media.complete !== true || media.passed !== true || media.failedObjects !== 0 || media.descriptorPlanPassed !== true || !validHash(media.verifiedObjectsHash) || media.referenceHash !== plan.referenceHash || ['recordsScanned', 'requiredObjects', 'uniqueObjects', 'immutableObjects', 'objectsWithoutSourceChecksum', 'objectsWithoutSourceLength', 'externalMediaReferencesNotVerified'].some(key => media[key] !== plan[key]) || media.objectsRead !== plan.requiredObjects || media.objectsAvailable !== plan.requiredObjects || media.checksumsVerified !== plan.requiredObjects - plan.objectsWithoutSourceChecksum || media.lengthsVerified !== plan.requiredObjects - plan.objectsWithoutSourceLength || !Number.isSafeInteger(media.bytesRead) || media.bytesRead < (plan.knownRequiredBytes || 0) || media.invalidReferences !== 0 || media.conflictingDescriptors !== 0 || media.failures?.length !== 0 || plan.descriptorPlanPassed !== true) throw new Error('BOUND_COMPLETE_REQUIRED_BLOB_VERIFICATION_REQUIRED')
  const retainedIntegrity = plan.objectsWithoutSourceChecksum === 0 && plan.objectsWithoutSourceLength === 0 && plan.externalMediaReferencesNotVerified === 0
  const fullSourceIntegrity = retainedIntegrity && !disposition
  if (media.fullSourceIntegrityVerified !== fullSourceIntegrity) throw new Error('MEDIA_INTEGRITY_SCOPE_MUST_NOT_BE_FALSIFIED')
  if (disposition && media.availableMediaIntegrityVerified !== retainedIntegrity) throw new Error('AVAILABLE_MEDIA_INTEGRITY_SCOPE_REQUIRED')
  const frozen = time(fence.writersFrozenSince), drained = time(fence.drainedAt), recorded = time(fence.recordedAt), expiry = time(fence.expiresAt)
  if (fence.version !== 1 || fence.active !== true || fence.candidateRun !== candidate.run || fence.candidateManifestHash !== candidateManifestHash || fence.sourceHash !== sourceHash || fence.sourceProject !== candidate.sourceProject || fence.sourceDatabase !== candidate.sourceDatabase || canonical(normalizeDatasets(fence.datasets)) !== canonical(datasets) || !Number.isFinite(frozen) || !Number.isFinite(drained) || drained < frozen || drained > snapshotStarted || !Number.isFinite(recorded) || recorded < sourceVerified || recorded > now || !Number.isFinite(expiry) || expiry <= now) throw new Error('SOURCE_WIDE_FROZEN_WRITER_EVIDENCE_REQUIRED')
  let blobOrphanTail
  if (SOURCE_WRITER_PLANES.some(plane => {
    const check = fence.planes?.[plane], checked = time(check?.checkedAt)
    if (!check || typeof check.method !== 'string' || check.method.trim().length < 8 || check.method.length > 500 || !Number.isFinite(checked) || checked < frozen || checked > drained) return true
    if (plane === 'blob-uploads-tokens-variants' && check.orphanOnlyTail === true) {
      blobOrphanTail = validateBlobOrphanTail({ plane: check, fence, candidate, candidateManifestHash, sourceHash, media, mediaPlan, mediaVerificationReportHash, now })
      return false
    }
    return check.blocked !== true || check.inFlightDrained !== true
  })) throw new Error('ALL_SOURCE_WRITER_PLANES_MUST_BE_BLOCKED_AND_DRAINED')
  const maintenance = fence.targetMaintenance
  if (maintenance?.active !== true || maintenance.allWritersBlocked !== true || maintenance.writeProbeStatus !== 503 || !/^[a-f0-9]{40}$/.test(maintenance.guardRevision || '') || !Number.isFinite(time(maintenance.verifiedAt)) || time(maintenance.verifiedAt) < frozen || time(maintenance.verifiedAt) > now) throw new Error('INDEPENDENT_ACTIVE_TARGET_MAINTENANCE_EVIDENCE_REQUIRED')
  const external = fence.externalMedia
  if (plan.externalMediaReferencesNotVerified > 0 && (external?.count !== plan.externalMediaReferencesNotVerified || external.status !== 'preserved-unverified-external-references' || external.riskAccepted !== true)) throw new Error('EXTERNAL_MEDIA_MUST_BE_EXPLICITLY_ACKNOWLEDGED_UNVERIFIED')
  if ((plan.objectsWithoutSourceChecksum > 0 || plan.objectsWithoutSourceLength > 0) && fence.blobIntegrityScope !== 'availability-and-existing-source-metadata-only') throw new Error('PARTIAL_SOURCE_METADATA_MUST_BE_EXPLICITLY_ACKNOWLEDGED')
  if (!queueDisposition && queueDispositionHash !== undefined) throw new Error('EXPLICIT_QUEUE_DISPOSITION_EVIDENCE_REQUIRED')
  const queueBinding = queueDisposition ? validateQueueDisposition({ evidence: queueDisposition, evidenceHash: queueDispositionHash, fence, expected: { ...snapshotExpected, sourceFenceEvidenceHash, target, sourceVerification: source }, now }) : null
  return { candidateRun: candidate.run, baselineRun: candidate.sourceBaselineRun, datasets, dataset, target, sourceHash, candidateManifestHash, sourceVerificationEpoch, sourceFenceExpiresAt: fence.expiresAt, mediaFullSourceIntegrityVerified: fullSourceIntegrity, externalMediaReferencesNotVerified: plan.externalMediaReferencesNotVerified, maintenanceMustRemainActive: true, ...(blobOrphanTail ? { blobOrphanTail } : {}), ...(queueBinding ? { queueDisposition: queueBinding } : {}), ...(disposition ? { mediaDisposition: disposition, mediaAvailableIntegrityVerified: retainedIntegrity, mediaDispositionCounts: Object.fromEntries(['rawCount', 'recordCount', 'claimCount', 'catalogCount', 'sourceRecordCount', 'omittedRecordCount', 'transformedRecordCount'].map(key => [key, counts[key]])) } : {}) }
}

async function activateCatalog({ db, client, context, audit, entries, candidate, nativeDisposition, verifyParity = importMongo }) {
  if (!client?.startSession || !db?.collection || audit.candidateRun !== context.candidateRun || audit.sourceHash !== context.sourceHash || audit.candidateManifestHash !== context.candidateManifestHash) throw new Error('EXACT_ACTIVATION_CONTEXT_REQUIRED')
  if (canonical(audit.queueDisposition) !== canonical(context.queueDisposition)) throw new Error('CURRENT_AUDITED_QUEUE_DISPOSITION_REQUIRED')
  if (canonical(audit.blobOrphanTail) !== canonical(context.blobOrphanTail)) throw new Error('CURRENT_AUDITED_BLOB_ORPHAN_TAIL_REQUIRED')
  if (canonical(audit.sourceVerificationEpoch) !== canonical(context.sourceVerificationEpoch)) throw new Error('CURRENT_AUDITED_SOURCE_VERIFICATION_EPOCH_REQUIRED')
  entries.assertUnchanged?.()
  await assertFence(db, context)
  // A saved report alone is not permission to skip current target acceptance.
  // Runtime writers remain blocked by false catalogs and external maintenance.
  if (Boolean(nativeDisposition) !== Boolean(context.mediaDisposition) || nativeDisposition && canonical(nativeDisposition.report) !== canonical(context.mediaDisposition)) throw new Error('CURRENT_AUDITED_MEDIA_DISPOSITION_REQUIRED')
  const parity = nativeDisposition ? await verifyParity(db, entries, candidate, context.datasets, true, { nativeDisposition }) : await verifyParity(db, entries, candidate, context.datasets, true)
  if (parity.verified !== true) throw new Error('CURRENT_TARGET_PARITY_REQUIRED')
  if (nativeDisposition && (canonical(parity.mediaDisposition) !== canonical(context.mediaDisposition) || parity.rawSourceIntegrityUnmodified !== true || Object.entries(context.mediaDispositionCounts || {}).some(([key, value]) => parity[key] !== value))) throw new Error('CURRENT_CLEANED_NATIVE_PARITY_REQUIRED')
  entries.assertUnchanged?.()
  const session = client.startSession()
  try {
    await session.withTransaction(async () => {
      if (!Number.isFinite(time(context.sourceFenceExpiresAt)) || time(context.sourceFenceExpiresAt) <= Date.now() + 60000) throw new Error('SOURCE_FENCE_EVIDENCE_EXPIRED_OR_TOO_CLOSE_TO_COMMIT')
      await assertFence(db, context, session)
      const collection = db.collection('talio_catalogs')
      const catalog = await collection.findOne({ _id: context.dataset }, { session })
      if (catalog?.purpose !== 'production' || catalog.status !== 'ready') throw new Error('SELECTED_CATALOG_MUST_BE_PRODUCTION_READY')
      const others = await collection.find({ _id: { $in: context.datasets.filter(value => value !== context.dataset) } }, { session }).toArray()
      if (others.some(value => value.purpose !== 'local-acceptance-only' || value.applicationCutover !== false || value.mongoVerified !== false)) throw new Error('OTHER_CATALOGS_MUST_REMAIN_LOCAL_NON_CUTOVER')
      const fence = await db.collection('talio_migration_controls').findOne({ _id: 'write-fence' }, { session })
      if (fence.expiresAt !== undefined && new Date(fence.expiresAt).getTime() <= Date.now() + 60000) throw new Error('TARGET_FENCE_EXPIRY_TOO_CLOSE_TO_COMMIT')
      if (time(context.sourceFenceExpiresAt) <= Date.now() + 60000) throw new Error('SOURCE_FENCE_EVIDENCE_EXPIRED_OR_TOO_CLOSE_TO_COMMIT')
      entries.assertUnchanged?.()
      // Touch the same fence delta commits use; concurrent release conflicts.
      const lock = await db.collection('talio_migration_controls').updateOne({ _id: 'write-fence', active: true, baselineRun: context.baselineRun, candidateRun: context.candidateRun }, { $set: { lastCatalogActivationHash: sha256(canonical(audit)) } }, { session })
      if (lock.matchedCount !== 1) throw new Error('TARGET_MAINTENANCE_FENCE_RELEASED')
      const changed = await collection.updateOne({ _id: context.dataset, applicationCutover: false, mongoVerified: false, purpose: 'production', status: 'ready' }, { $set: { mongoVerified: true, applicationCutover: true, mongoVerificationAudit: audit } }, { session })
      if (changed.matchedCount !== 1) throw new Error('CATALOG_ACTIVATION_PRECONDITION_CHANGED')
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary', maxCommitTimeMS: 30000 })
  } finally { await session.endSession() }
  return { activated: true, candidateRun: context.candidateRun, dataset: context.dataset, maintenanceActive: true, maintenanceReleasePerformed: false, otherCatalogsActivated: false }
}

async function main() {
  process.umask(0o077)
  const [candidateRun, ...args] = process.argv.slice(2)
  if (!validIdentity(candidateRun)) throw new Error('EXPLICIT_FINAL_CANDIDATE_RUN_REQUIRED')
  const flags = {}
  for (const arg of args) {
    if (arg === '--execute' && !flags.execute) { flags.execute = true; continue }
    const match = /^--(host|database|dataset|datasets|source-fence|media-report|queue-disposition|disposition|disposition-sha256|inventory|inventory-sha256|decision)=([^=]+)$/.exec(arg)
    if (!match || flags[match[1]]) throw new Error('INVALID_OR_DUPLICATE_ACTIVATION_FLAG')
    flags[match[1]] = match[2]
  }
  if (!flags.host || !flags.database || !flags.dataset || !flags.datasets || !flags['source-fence'] || !flags['media-report']) throw new Error('EXACT_ACTIVATION_TARGET_AND_EVIDENCE_FLAGS_REQUIRED')
  const root = path.resolve(__dirname, '../..'), directory = path.join(root, '.migration-data', candidateRun)
  const readEnv = file => fs.existsSync(path.join(root, file)) ? dotenv.parse(fs.readFileSync(path.join(root, file))) : {}
  const env = { ...readEnv('.env'), ...readEnv('.env.local'), ...process.env }
  const target = assertTarget(env.MONGODB_URI, env.MONGODB_DATABASE, flags.host, flags.database)
  const candidate = await readProtectedJson(path.join(directory, 'manifest.json'))
  if (candidate.value.run !== candidateRun) throw new Error('EXACT_CANDIDATE_RUN_REQUIRED')
  const source = await readProtectedJson(path.join(directory, 'source-verification.json'))
  const mongo = await readProtectedJson(path.join(directory, 'verify-mongo.json'))
  const media = await readProtectedJson(flags['media-report'])
  const fence = await readProtectedJson(flags['source-fence'])
  const queueDisposition = flags['queue-disposition'] ? await readProtectedJson(flags['queue-disposition']) : null
  const datasets = normalizeDatasets(flags.datasets.split(',')), entries = await loadIndexedEntries(directory, candidate.value)
  let disposition
  try {
    disposition = await loadNativeDisposition(entries, candidate.value, await fsp.readFile(path.join(directory, 'manifest.json')), datasets, flags, target)
    const context = validateActivationEvidence({ candidate: candidate.value, candidateManifestHash: candidate.hash, source: source.value, mongo: mongo.value, media: media.value, mediaVerificationReportHash: media.hash, fence: fence.value, sourceFenceEvidenceHash: fence.hash, queueDisposition: queueDisposition?.value, queueDispositionHash: queueDisposition?.hash, dataset: flags.dataset, datasets, target, disposition: disposition?.binding, mediaPlan: collectMediaPlan(entries, datasets, { nativeDisposition: disposition?.createOverlay() }), counts: planMongo(entries, candidate.value, datasets, { nativeDisposition: disposition?.createOverlay() }) })
    entries.assertUnchanged()
    if (!flags.execute) { console.log(JSON.stringify({ event: 'catalog-activation-evidence-plan', candidateRun, dataset: context.dataset, evidenceValidated: true, currentTargetVerificationStillRequired: true, writes: 0, maintenanceReleasePerformed: false })); return }
    if (env.TALIO_MIGRATION_FREEZE !== '1' || process.env.MONGODB_ACTIVATION_CONFIRM !== 'activate-verified-production-catalog-under-maintenance') throw new Error('EXPLICIT_ACTIVATION_CONFIRMATION_AND_MAINTENANCE_REQUIRED')
    const audit = { version: 1, ...context, sourceVerificationHash: source.hash, mongoParityReportHash: mongo.hash, mediaVerificationReportHash: media.hash, sourceFenceEvidenceHash: fence.hash, activatedAt: new Date().toISOString(), maintenanceReleasePerformed: false, deployedAcceptanceRequiredBeforeMaintenanceRelease: true }
    const { MongoClient } = require('mongodb')
    const client = new MongoClient(env.MONGODB_URI, { maxPoolSize: 2, promoteBuffers: true, serverSelectionTimeoutMS: 15000 })
    try {
      await client.connect()
      const result = await activateCatalog({ db: client.db(target.databaseName), client, context, audit, entries, candidate: candidate.value, nativeDisposition: disposition?.createOverlay() })
      await fsp.writeFile(path.join(directory, 'catalog-activation.json'), JSON.stringify({ ...result, audit }, null, 2), { mode: 0o600, flag: 'wx' })
      console.log(JSON.stringify({ event: 'catalog-activated-under-maintenance', ...result }))
    } finally { await client.close() }
  } finally { disposition?.close(); entries.close() }
}

if (require.main === module) main().catch(error => { console.error(JSON.stringify({ event: 'catalog-activation-failed', code: /^[A-Z][A-Z_]{1,100}$/.test(error.message || '') ? error.message : 'ACTIVATION_FAILED', privateDetailsOmitted: true })); process.exitCode = 1 })
module.exports = { SOURCE_WRITER_PLANES, readProtectedJson, validateActivationEvidence, activateCatalog }
