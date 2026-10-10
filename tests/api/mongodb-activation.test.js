const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { SOURCE_WRITER_PLANES, readProtectedJson, validateActivationEvidence, activateCatalog } = require('../../scripts/mongodb-migration/activate-catalog.cjs')
const { sourceCollectionsHash, sourceTreeCounts, SOURCE_VERIFICATION_EPOCH_PROTOCOL } = require('../../scripts/mongodb-migration/migrate.cjs')
const { memoryMongoDriver } = require('../helpers/mongoDriver')
const { QUEUE_DISCARD_DECISION, TALIO_VERCEL_PROJECT, TALIO_VERCEL_TEAM, QUEUE_TOPICS } = require('../../scripts/mongodb-migration/queue-disposition.cjs')
const { REVIEWED_SOURCE_REVISION, REVIEWED_SOURCE_HASHES, REVIEWED_TOKEN_PROTOCOL, TOKEN_PROTOCOL_REVIEW_HASH } = require('../../scripts/mongodb-migration/blob-orphan-tail.cjs')

function evidence() {
  const now = Date.now(), at = offset => new Date(now + offset).toISOString()
  const candidate = { run: 'mongo-final-tests', sourceBaselineRun: 'mongo-baseline-tests', sourceBaselineManifestHash: 'a'.repeat(64), sourceProject: 'source-tests', sourceDatabase: '(default)', complete: true, sourceVerificationRequired: true, datasets: ['live-tests', 'local-tests'], collections: [], startedAt: at(-60000), exportFinishedAt: at(-50000) }
  const candidateManifestHash = 'b'.repeat(64), sourceHash = sourceCollectionsHash(candidate.collections), target = { host: 'cluster.example.test', databaseName: 'talio' }
  const binding = { run: candidate.run, candidateManifestHash, sourceHash, sourceHashVersion: 'canonical-sorted-collections-v1', datasets: candidate.datasets, verifiedAt: at(-20000) }
  const counts = { rawCount: 2, recordCount: 1, claimCount: 0, catalogCount: 2 }
  const source = { run: candidate.run, complete: true, unchangedAtRead: true, sourceHash, sourceHashVersion: binding.sourceHashVersion, verifiedAt: at(-30000) }
  const mediaPlan = { report: { recordsScanned: 1, requiredObjects: 1, uniqueObjects: 1, immutableObjects: 1, objectsWithoutSourceChecksum: 0, objectsWithoutSourceLength: 0, externalMediaReferencesNotVerified: 0, referenceHash: 'c'.repeat(64), descriptorPlanPassed: true } }
  const media = { ...binding, ...mediaPlan.report, command: 'verify', writes: 0, complete: true, passed: true, failedObjects: 0, verifiedObjectsHash: 'd'.repeat(64), objectsRead: 1, objectsAvailable: 1, checksumsVerified: 1, lengthsVerified: 1, bytesRead: 10, invalidReferences: 0, conflictingDescriptors: 0, failures: [], fullSourceIntegrityVerified: true }
  const fence = { version: 1, active: true, candidateRun: candidate.run, candidateManifestHash, sourceHash, sourceProject: candidate.sourceProject, sourceDatabase: candidate.sourceDatabase, datasets: candidate.datasets, writersFrozenSince: at(-120000), drainedAt: at(-90000), recordedAt: at(-10000), expiresAt: at(3600000), planes: Object.fromEntries(SOURCE_WRITER_PLANES.map(plane => [plane, { blocked: true, inFlightDrained: true, method: 'independent blocked write probe', checkedAt: at(-100000) }])), targetMaintenance: { active: true, allWritersBlocked: true, writeProbeStatus: 503, guardRevision: 'e'.repeat(40), verifiedAt: at(-10000) } }
  return { candidate, candidateManifestHash, source, mongo: { ...binding, ...counts, target: { ...target }, verified: true }, media, fence, dataset: 'live-tests', datasets: candidate.datasets, target, mediaPlan, counts, now }
}

test('requires exact final candidate, source, target and successful report bindings', () => {
  expect(validateActivationEvidence(evidence())).toMatchObject({ dataset: 'live-tests', maintenanceMustRemainActive: true })
  for (const alter of [
    value => { value.candidate.complete = false },
    value => { value.source.sourceHash = 'f'.repeat(64) },
    value => { value.source.verifiedAt = value.candidate.startedAt },
    value => { value.mongo.run = 'different-run' },
    value => { value.mongo.candidateManifestHash = 'f'.repeat(64) },
    value => { value.mongo.target.databaseName = 'other' },
    value => { value.mongo.recordCount++ },
    value => { value.mongo.verified = false },
    value => { value.media.datasets = ['local-tests'] },
    value => { value.media.objectsAvailable = 0 },
    value => { value.media.referenceHash = 'f'.repeat(64) },
  ]) { const value = evidence(); alter(value); expect(() => validateActivationEvidence(value)).toThrow() }
})

test('fails closed on every unfenced source writer, undrained operations and maintenance gaps', () => {
  for (const plane of SOURCE_WRITER_PLANES) {
    const value = evidence(); delete value.fence.planes[plane]
    expect(() => validateActivationEvidence(value)).toThrow('ALL_SOURCE_WRITER_PLANES')
  }
  for (const alter of [
    value => { value.fence.drainedAt = value.candidate.exportFinishedAt },
    value => { value.fence.planes['socket-io'].inFlightDrained = false },
    value => { value.fence.expiresAt = new Date(value.now - 1).toISOString() },
    value => { value.fence.targetMaintenance.writeProbeStatus = 200 },
    value => { value.fence.targetMaintenance.guardRevision = 'unknown' },
  ]) { const value = evidence(); alter(value); expect(() => validateActivationEvidence(value)).toThrow() }
})

function withVerifiedSnapshot(value = evidence()) {
  const original = JSON.stringify(value.candidate)
  Object.assign(value.source, { candidateManifestHash: value.candidateManifestHash, sourceProject: value.candidate.sourceProject, sourceDatabase: value.candidate.sourceDatabase, datasets: [...value.datasets], verificationProtocol: SOURCE_VERIFICATION_EPOCH_PROTOCOL, verificationStartedAt: new Date(value.now - 40000).toISOString(), fullBodiesRead: true, fullTopologyVerified: true, metadataUpdateTimesVerified: true, noReuse: true, reusedDocuments: 0, archiveUnchanged: true, ...sourceTreeCounts(value.candidate.collections) })
  value.fence.drainedAt = new Date(value.now - 45000).toISOString()
  expect(Date.parse(value.fence.drainedAt)).toBeGreaterThan(Date.parse(value.candidate.startedAt))
  expect(JSON.stringify(value.candidate)).toBe(original)
  return value
}

test('a new exact full-body/topology post-drain verification may establish an unchanged snapshot epoch without relabeling the candidate', () => {
  const value = withVerifiedSnapshot(), before = JSON.stringify(value.candidate)
  expect(validateActivationEvidence(value).sourceVerificationEpoch).toEqual({ mode: SOURCE_VERIFICATION_EPOCH_PROTOCOL, startedAt: value.source.verificationStartedAt, verifiedAt: value.source.verifiedAt })
  expect(JSON.stringify(value.candidate)).toBe(before)
  const legacy = evidence(); legacy.fence.drainedAt = value.fence.drainedAt
  expect(() => validateActivationEvidence(legacy)).toThrow('SOURCE_WIDE_FROZEN')
})

test.each([
  value => { delete value.source.verificationStartedAt },
  value => { value.source.verificationStartedAt = 'invalid' },
  value => { value.source.verificationStartedAt = value.candidate.startedAt },
  value => { value.source.verificationStartedAt = new Date(value.now + 1).toISOString() },
  value => { value.source.verificationStartedAt = new Date(Date.parse(value.source.verifiedAt) + 1).toISOString() },
  value => { delete value.source.verificationProtocol },
  value => { value.source.fullBodiesRead = false },
  value => { value.source.fullTopologyVerified = false },
  value => { value.source.metadataUpdateTimesVerified = false },
  value => { value.source.noReuse = false },
  value => { value.source.reusedDocuments = 1 },
  value => { value.source.archiveUnchanged = false },
  value => { value.source.documentsVerified++ },
  value => { value.source.collectionsVerified++ },
  value => { value.source.missingParentsVerified++ },
  value => { value.source.candidateManifestHash = 'f'.repeat(64) },
  value => { value.source.sourceProject = 'foreign' },
  value => { value.source.sourceDatabase = 'foreign' },
  value => { value.source.datasets = ['foreign-tests'] },
])('verification epoch fails closed without exact complete post-export no-reuse source evidence (%#)', change => {
  const value = withVerifiedSnapshot(); change(value)
  expect(() => validateActivationEvidence(value)).toThrow('FULL_SOURCE_VERIFICATION_EPOCH')
})

test('new epoch never permits drain after first source read or media/Mongo reports before verification completion', () => {
  for (const change of [
    value => { value.fence.drainedAt = new Date(Date.parse(value.source.verificationStartedAt) + 1).toISOString() },
    value => { value.media.verifiedAt = value.source.verificationStartedAt },
    value => { value.mongo.verifiedAt = value.source.verificationStartedAt },
    value => { value.fence.planes['old-deployments'].checkedAt = new Date(Date.parse(value.fence.drainedAt) + 1).toISOString() },
  ]) { const value = withVerifiedSnapshot(); change(value); expect(() => validateActivationEvidence(value)).toThrow() }
})

function withBlobOrphanTail(value = evidence()) {
  const at = offset => new Date(value.now + offset).toISOString()
  value.candidate.sourceProject = value.fence.sourceProject = 'talio-hrms'
  value.mediaVerificationReportHash = '1'.repeat(64)
  value.fence.planes['firestore-data-principal'].probeReportHash = '2'.repeat(64)
  value.fence.planes['blob-uploads-tokens-variants'] = {
    blocked: false, inFlightDrained: false, orphanOnlyTail: true,
    method: 'reviewed append-only orphan tail; all descriptor commits denied', checkedAt: at(-95000),
    orphanTail: {
      version: 1, invariant: 'append-only-unreferenced-client-upload-tail-v1', run: value.candidate.run,
      candidateManifestHash: value.candidateManifestHash, sourceHash: value.source.sourceHash,
      sourceProject: value.candidate.sourceProject, sourceDatabase: value.candidate.sourceDatabase,
      sourceRevision: REVIEWED_SOURCE_REVISION, reviewedSourceHashes: { ...REVIEWED_SOURCE_HASHES },
      tokenProtocolReviewHash: TOKEN_PROTOCOL_REVIEW_HASH, clientProtocol: { ...REVIEWED_TOKEN_PROTOCOL },
      sourceDeployment: { revision: REVIEWED_SOURCE_REVISION, allTokenIssuersReviewed: true, providerEvidenceHash: '3'.repeat(64), checkedAt: at(-110000) },
      sourceMetadataWriterFence: { positiveCatalogRead: true, negativeMutationPermissionDenied: true, projectWritePermissionsGranted: 0, probeReportHash: '2'.repeat(64), checkedAt: at(-105000) },
      serverBlobWriterFence: { blocked: true, inFlightDrained: true, httpFenceProofHash: '4'.repeat(64), cronFenceProofHash: '5'.repeat(64), checkedAt: at(-96000) },
      physicalClientUploadsBlocked: false, physicalClientUploadsDrained: false, clientTokensExpired: false,
      orphanCleanupDeletionAuthorized: false, orphanCleanupPerformed: false, descriptorReplayPerformed: false,
      retainedMedia: { mediaVerificationReportHash: value.mediaVerificationReportHash, referenceHash: value.mediaPlan.report.referenceHash, verifiedObjectsHash: value.media.verifiedObjectsHash, requiredObjects: value.mediaPlan.report.requiredObjects },
    },
  }
  return value
}

test('optional Blob orphan-only tail preserves truthful physical state and binds exact reviewed code/media', () => {
  const value = withBlobOrphanTail(), context = validateActivationEvidence(value)
  expect(context.blobOrphanTail).toMatchObject({ orphanOnlyTail: true, physicalClientUploadsBlocked: false, physicalClientUploadsDrained: false, clientTokensExpired: false, sourceRevision: REVIEWED_SOURCE_REVISION, mediaVerificationReportHash: value.mediaVerificationReportHash })
  expect(context.maintenanceMustRemainActive).toBe(true)
  expect(value.fence.planes['blob-uploads-tokens-variants']).toMatchObject({ blocked: false, inFlightDrained: false })
  expect(validateActivationEvidence(evidence())).not.toHaveProperty('blobOrphanTail')
})

test('immutable Blob issuer review may finish after candidate export but before fence recording', () => {
  const value = withBlobOrphanTail()
  const deployment = value.fence.planes['blob-uploads-tokens-variants'].orphanTail.sourceDeployment
  deployment.checkedAt = new Date(value.now - 15000).toISOString()
  expect(Date.parse(deployment.checkedAt)).toBeGreaterThan(Date.parse(value.candidate.exportFinishedAt))
  expect(validateActivationEvidence(value).blobOrphanTail.sourceDeploymentEvidenceHash).toBe(deployment.providerEvidenceHash)
  deployment.checkedAt = value.fence.recordedAt
  expect(validateActivationEvidence(value)).toHaveProperty('blobOrphanTail')
})

test('immutable Blob review rejects before-freeze, unrecorded, future and missing timestamps', () => {
  for (const timestamp of ['before-freeze', 'after-recording', 'future', 'missing', 'invalid']) {
    const value = withBlobOrphanTail()
    const deployment = value.fence.planes['blob-uploads-tokens-variants'].orphanTail.sourceDeployment
    deployment.checkedAt = timestamp === 'before-freeze' ? new Date(Date.parse(value.fence.writersFrozenSince) - 1).toISOString()
      : timestamp === 'after-recording' ? new Date(Date.parse(value.fence.recordedAt) + 1).toISOString()
        : timestamp === 'future' ? new Date(value.now + 1).toISOString()
          : timestamp === 'missing' ? undefined : 'invalid'
    expect(() => validateActivationEvidence(value)).toThrow('BLOB_ORPHAN')
  }
})

test('later immutable review never permits metadata-denial or server-drain proofs after drain', () => {
  for (const key of ['sourceMetadataWriterFence', 'serverBlobWriterFence']) {
    const value = withBlobOrphanTail()
    const tail = value.fence.planes['blob-uploads-tokens-variants'].orphanTail
    tail.sourceDeployment.checkedAt = new Date(value.now - 15000).toISOString()
    tail[key].checkedAt = new Date(Date.parse(value.fence.drainedAt) + 1).toISOString()
    expect(() => validateActivationEvidence(value)).toThrow('BLOB_ORPHAN')
  }
})

test('Blob orphan alternative rejects every missing or mismatched typed invariant, proof and binding', () => {
  const mutateTail = change => value => change(value.fence.planes['blob-uploads-tokens-variants'].orphanTail)
  for (const change of [
    value => { value.fence.planes['blob-uploads-tokens-variants'].blocked = true },
    value => { value.fence.planes['blob-uploads-tokens-variants'].inFlightDrained = true },
    value => { value.fence.planes['blob-uploads-tokens-variants'].orphanOnlyTail = false },
    value => { delete value.mediaVerificationReportHash },
    value => { value.fence.planes['firestore-data-principal'].probeReportHash = 'f'.repeat(64) },
    mutateTail(tail => { tail.version = 2 }), mutateTail(tail => { tail.run = 'foreign-run' }),
    mutateTail(tail => { tail.candidateManifestHash = 'f'.repeat(64) }), mutateTail(tail => { tail.sourceHash = 'f'.repeat(64) }),
    mutateTail(tail => { tail.sourceProject = 'foreign' }), mutateTail(tail => { tail.sourceDatabase = 'foreign' }),
    mutateTail(tail => { tail.sourceRevision = 'f'.repeat(40) }),
    mutateTail(tail => { tail.reviewedSourceHashes['app/api/upload/token/route.js'] = 'f'.repeat(64) }),
    mutateTail(tail => { tail.tokenProtocolReviewHash = 'f'.repeat(64) }),
    ...Object.keys(REVIEWED_TOKEN_PROTOCOL).map(key => mutateTail(tail => { delete tail.clientProtocol[key] })),
    mutateTail(tail => { tail.sourceDeployment.revision = 'f'.repeat(40) }),
    mutateTail(tail => { tail.sourceDeployment.allTokenIssuersReviewed = false }),
    mutateTail(tail => { tail.sourceDeployment.providerEvidenceHash = 'unknown' }),
    mutateTail(tail => { tail.sourceMetadataWriterFence.negativeMutationPermissionDenied = false }),
    mutateTail(tail => { tail.sourceMetadataWriterFence.positiveCatalogRead = false }),
    mutateTail(tail => { tail.sourceMetadataWriterFence.projectWritePermissionsGranted = 1 }),
    mutateTail(tail => { tail.sourceMetadataWriterFence.probeReportHash = 'unknown' }),
    mutateTail(tail => { tail.serverBlobWriterFence.blocked = false }),
    mutateTail(tail => { tail.serverBlobWriterFence.inFlightDrained = false }),
    mutateTail(tail => { tail.serverBlobWriterFence.httpFenceProofHash = 'unknown' }),
    mutateTail(tail => { tail.serverBlobWriterFence.cronFenceProofHash = 'unknown' }),
    mutateTail(tail => { tail.serverBlobWriterFence.checkedAt = tail.sourceDeployment.checkedAt }),
    mutateTail(tail => { tail.physicalClientUploadsBlocked = true }), mutateTail(tail => { tail.physicalClientUploadsDrained = true }),
    mutateTail(tail => { tail.clientTokensExpired = true }), mutateTail(tail => { tail.orphanCleanupDeletionAuthorized = true }),
    mutateTail(tail => { tail.orphanCleanupPerformed = true }), mutateTail(tail => { tail.descriptorReplayPerformed = true }),
    mutateTail(tail => { tail.retainedMedia.mediaVerificationReportHash = 'f'.repeat(64) }),
    mutateTail(tail => { tail.retainedMedia.referenceHash = 'f'.repeat(64) }),
    mutateTail(tail => { tail.retainedMedia.verifiedObjectsHash = 'f'.repeat(64) }),
    mutateTail(tail => { tail.retainedMedia.requiredObjects++ }),
  ]) { const value = withBlobOrphanTail(); change(value); expect(() => validateActivationEvidence(value)).toThrow() }
  for (const key of ['sourceDeployment', 'sourceMetadataWriterFence', 'serverBlobWriterFence']) {
    const value = withBlobOrphanTail(); value.fence.planes['blob-uploads-tokens-variants'].orphanTail[key].checkedAt = new Date(value.now).toISOString()
    expect(() => validateActivationEvidence(value)).toThrow('BLOB_ORPHAN')
  }
})

test('Blob alternative cannot relax non-Blob planes, source freshness, required media or Mongo parity', () => {
  for (const plane of SOURCE_WRITER_PLANES.filter(name => name !== 'blob-uploads-tokens-variants')) {
    const value = withBlobOrphanTail(); value.fence.planes[plane].inFlightDrained = false
    expect(() => validateActivationEvidence(value)).toThrow()
  }
  for (const change of [
    value => { value.source.unchangedAtRead = false }, value => { value.mongo.verified = false },
    value => { value.media.objectsAvailable = 0 }, value => { value.media.checksumsVerified = 0 },
    value => { value.media.failedObjects = 1 }, value => { value.fence.targetMaintenance.active = false },
  ]) { const value = withBlobOrphanTail(); change(value); expect(() => validateActivationEvidence(value)).toThrow() }
})

test('Blob orphan-tail safety is separate from approved unavailable-media cleanup and queue disposition', () => {
  expect(validateActivationEvidence(withBlobOrphanTail(dispositionEvidence()))).toMatchObject({ blobOrphanTail: { orphanCleanupDeletionAuthorized: false }, mediaDisposition: { decision: 'remove-unavailable-media-only' } })
  expect(validateActivationEvidence(withQueueDisposition(withBlobOrphanTail())).queueDisposition.acknowledgementValidated).toBe(true)
})

function withQueueDisposition(value = evidence()) {
  const at = offset => new Date(value.now + offset).toISOString()
  value.sourceFenceEvidenceHash = '7'.repeat(64)
  value.queueDispositionHash = '8'.repeat(64)
  value.queueDisposition = {
    version: 1, decision: QUEUE_DISCARD_DECISION, userAuthorization: QUEUE_DISCARD_DECISION,
    authorizationMessageHash: '9'.repeat(64), authorizedAt: at(-180000), recordedAt: at(-5000),
    unknownOutstandingCountAccepted: true, outstandingJobCount: null, preservationVerified: false,
    businessDataDeletionAuthorized: false, queueReplayAuthorized: false,
    run: value.candidate.run, candidateManifestHash: value.candidateManifestHash, sourceHash: value.source.sourceHash,
    sourceFenceEvidenceHash: value.sourceFenceEvidenceHash, sourceProject: value.candidate.sourceProject,
    sourceDatabase: value.candidate.sourceDatabase, datasets: value.datasets, target: value.target,
    vercelProjectId: TALIO_VERCEL_PROJECT, vercelTeamId: TALIO_VERCEL_TEAM, environment: 'production', topics: [...QUEUE_TOPICS],
    targetQueueIsolation: { deploymentId: 'dpl_newMongo', oldProductionDeploymentId: 'dpl_oldSource', freshDeploymentVerified: true,
      defaultDeploymentPinning: true, deploymentlessRuntimePollingEnabled: false, archivedJobsReplayed: false,
      runtimeRevision: 'a'.repeat(40), providerDeploymentEvidenceHash: 'b'.repeat(64), runtimeQueueAuditHash: 'c'.repeat(64), verifiedAt: at(-10000) },
  }
  return value
}

test('optional queue evidence is candidate/fence/target bound and retained in activation context', () => {
  const value = withQueueDisposition(), context = validateActivationEvidence(value)
  expect(context.queueDisposition).toMatchObject({ reportHash: value.queueDispositionHash, sourceFenceEvidenceHash: value.sourceFenceEvidenceHash,
    decision: QUEUE_DISCARD_DECISION, acknowledgementValidated: true, preservationVerified: false, businessDataDeletionAuthorized: false, maintenanceReleasePerformed: false })
  expect(context.maintenanceMustRemainActive).toBe(true)
  expect(validateActivationEvidence(evidence())).not.toHaveProperty('queueDisposition')
  for (const alter of [
    input => { input.queueDisposition.sourceFenceEvidenceHash = 'f'.repeat(64) },
    input => { input.queueDisposition.target = { ...input.target, databaseName: 'foreign' } },
    input => { input.queueDispositionHash = undefined },
    input => { input.queueDisposition = undefined },
    input => { input.queueDisposition.targetQueueIsolation.deploymentlessRuntimePollingEnabled = true },
    input => { input.queueDisposition.outstandingJobCount = 0 },
  ]) { const input = withQueueDisposition(); alter(input); expect(() => validateActivationEvidence(input)).toThrow() }
})

test('queue disposition uses the exact independently validated full source epoch, not a late drain override', () => {
  const value = withQueueDisposition(withVerifiedSnapshot())
  expect(validateActivationEvidence(value).queueDisposition.sourceVerificationEpoch).toEqual({ mode: SOURCE_VERIFICATION_EPOCH_PROTOCOL, startedAt: value.source.verificationStartedAt, verifiedAt: value.source.verifiedAt })
  delete value.source.noReuse
  expect(() => validateActivationEvidence(value)).toThrow('FULL_SOURCE_VERIFICATION_EPOCH')
})

test('approved queue discard cannot bypass any source writer, parity, media or maintenance gate', () => {
  for (const plane of SOURCE_WRITER_PLANES) {
    const value = withQueueDisposition(); delete value.fence.planes[plane]
    expect(() => validateActivationEvidence(value)).toThrow('ALL_SOURCE_WRITER_PLANES')
  }
  for (const alter of [
    input => { input.mongo.verified = false }, input => { input.media.failedObjects = 1 },
    input => { input.source.unchangedAtRead = false }, input => { input.fence.targetMaintenance.active = false },
  ]) { const value = withQueueDisposition(); alter(value); expect(() => validateActivationEvidence(value)).toThrow() }
})

test('external links and incomplete source metadata cannot be described as full integrity', () => {
  const value = evidence()
  value.mediaPlan.report.externalMediaReferencesNotVerified = value.media.externalMediaReferencesNotVerified = 2
  value.media.fullSourceIntegrityVerified = false
  expect(() => validateActivationEvidence(value)).toThrow('EXTERNAL_MEDIA')
  value.fence.externalMedia = { count: 2, status: 'preserved-unverified-external-references', riskAccepted: true }
  expect(validateActivationEvidence(value).mediaFullSourceIntegrityVerified).toBe(false)
  value.media.fullSourceIntegrityVerified = true
  expect(() => validateActivationEvidence(value)).toThrow('MUST_NOT_BE_FALSIFIED')
  value.media.fullSourceIntegrityVerified = false
  value.mediaPlan.report.objectsWithoutSourceChecksum = value.media.objectsWithoutSourceChecksum = 1
  value.media.checksumsVerified = 0
  expect(() => validateActivationEvidence(value)).toThrow('PARTIAL_SOURCE_METADATA')
  value.fence.blobIntegrityScope = 'availability-and-existing-source-metadata-only'
  expect(validateActivationEvidence(value).externalMediaReferencesNotVerified).toBe(2)
})

function dispositionEvidence() {
  const value = evidence()
  value.disposition = { complete: true, decision: 'remove-unavailable-media-only', userAuthorization: 'remove-unavailable-media-only', run: value.candidate.run, datasets: value.datasets, target: value.target, candidateManifestHash: value.candidateManifestHash, sourceHash: value.source.sourceHash, reportHash: '1'.repeat(64), ledgerSha256: '2'.repeat(64), operationsHash: '3'.repeat(64), inventoryReportHash: '4'.repeat(64), referenceHash: '5'.repeat(64), inventoryHash: '6'.repeat(64), changedRecords: 2, deletedGalleryRecords: 1, deletedNativeRecords: 1 }
  for (const report of [value.mongo, value.media, value.mediaPlan.report, value.counts]) report.mediaDisposition = value.disposition
  for (const report of [value.mongo, value.counts]) Object.assign(report, { sourceRecordCount: 2, omittedRecordCount: 1, transformedRecordCount: 1, rawSourceIntegrityUnmodified: true })
  value.media.fullSourceIntegrityVerified = false; value.media.availableMediaIntegrityVerified = true
  return value
}

test('authorized media disposition binds exact cleaned counts and retained-media scope without weakening fences', () => {
  expect(validateActivationEvidence(dispositionEvidence())).toMatchObject({ mediaFullSourceIntegrityVerified: false, mediaAvailableIntegrityVerified: true, mediaDisposition: { decision: 'remove-unavailable-media-only' } })
  for (const alter of [
    value => { value.disposition = undefined },
    value => { value.disposition = { ...value.disposition, decision: 'delete-any-data' } },
    value => { value.disposition = { ...value.disposition, reportHash: 'invalid' } },
    value => { value.mongo.omittedRecordCount++ },
    value => { value.media.fullSourceIntegrityVerified = true },
    value => { value.media.availableMediaIntegrityVerified = false },
    value => { value.media = { ...value.media, mediaDisposition: { ...value.disposition, operationsHash: 'f'.repeat(64) } } },
    value => { value.fence.planes['firestore-data-principal'].blocked = false },
    value => { value.fence.targetMaintenance.active = false },
    value => { value.media.failedObjects = 1 },
  ]) { const value = dispositionEvidence(); alter(value); expect(() => validateActivationEvidence(value)).toThrow() }
})

test('evidence files must be owned, private, absolute regular files, not symlinks', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-activation-evidence-'))
  try {
    const file = path.join(directory, 'evidence.json'), link = path.join(directory, 'link.json')
    await fs.writeFile(file, JSON.stringify({ proof: true }), { mode: 0o600 })
    expect((await readProtectedJson(file)).value).toEqual({ proof: true })
    await fs.chmod(file, 0o644)
    await expect(readProtectedJson(file)).rejects.toThrow('PROTECTED_OWNED')
    await fs.chmod(file, 0o600); await fs.symlink(file, link)
    await expect(readProtectedJson(link)).rejects.toThrow()
    await expect(readProtectedJson('evidence.json')).rejects.toThrow('ABSOLUTE')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

function target() {
  const native = memoryMongoDriver(), collection = native.db.collection.bind(native.db)
  native.db.collection = name => ({ ...collection(name), async updateOne(filter, update) {
    const record = [...native.bank(name).values()].find(value => Object.entries(filter).every(([key, expected]) => value[key] === expected))
    if (!record) return { matchedCount: 0 }
    Object.assign(record, update.$set); return { matchedCount: 1 }
  } })
  const proof = evidence(), context = validateActivationEvidence(proof)
  const catalog = { _id: 'live-tests', purpose: 'production', status: 'ready', applicationCutover: false, mongoVerified: false, tenants: [{ tenantId: 'immutable-auth-identity', databaseName: 'talio_company_test', active: true }], settings: { retained: true } }
  native.bank('talio_catalogs').set('live-tests', catalog)
  native.bank('talio_catalogs').set('local-tests', { _id: 'local-tests', purpose: 'local-acceptance-only', status: 'verified-local-dataset', applicationCutover: false, mongoVerified: false })
  native.bank('talio_migration_controls').set('write-fence', { _id: 'write-fence', active: true, baselineRun: context.baselineRun, candidateRun: context.candidateRun, datasets: context.datasets })
  const audit = { ...context, sourceFenceEvidenceHash: 'f'.repeat(64) }
  return { ...native, context, candidate: proof.candidate, entries: new Map(), audit, verifyParity: jest.fn(async () => ({ verified: true })) }
}

test('activation transaction changes selected flags and audit only, retains local catalog and active fence', async () => {
  const native = target(), tenants = JSON.stringify(native.bank('talio_catalogs').get('live-tests').tenants)
  expect(await activateCatalog(native)).toMatchObject({ activated: true, maintenanceActive: true, maintenanceReleasePerformed: false, otherCatalogsActivated: false })
  expect(native.verifyParity).toHaveBeenCalledWith(native.db, native.entries, native.candidate, native.context.datasets, true)
  const catalog = native.bank('talio_catalogs').get('live-tests')
  expect(catalog).toMatchObject({ mongoVerified: true, applicationCutover: true, settings: { retained: true }, mongoVerificationAudit: native.audit })
  expect(JSON.stringify(catalog.tenants)).toBe(tenants)
  expect(native.bank('talio_catalogs').get('local-tests')).toMatchObject({ mongoVerified: false, applicationCutover: false })
  expect(native.bank('talio_migration_controls').get('write-fence').active).toBe(true)
})

test('activation persists optional queue risk acknowledgement unchanged and refuses dropped audit binding', async () => {
  const native = target()
  native.context = validateActivationEvidence(withQueueDisposition())
  native.audit = { ...native.context }
  await expect(activateCatalog(native)).resolves.toMatchObject({ activated: true, maintenanceReleasePerformed: false })
  expect(native.bank('talio_catalogs').get('live-tests').mongoVerificationAudit.queueDisposition).toEqual(native.context.queueDisposition)
  const denied = target()
  denied.context = validateActivationEvidence(withQueueDisposition())
  await expect(activateCatalog(denied)).rejects.toThrow('CURRENT_AUDITED_QUEUE_DISPOSITION_REQUIRED')
  expect(denied.verifyParity).not.toHaveBeenCalled()
  expect(denied.bank('talio_catalogs').get('live-tests').applicationCutover).toBe(false)
})

test('activation persists truthful Blob tail binding and refuses a missing or modified audited invariant', async () => {
  const native = target()
  native.context = validateActivationEvidence(withBlobOrphanTail()); native.audit = { ...native.context }
  await expect(activateCatalog(native)).resolves.toMatchObject({ activated: true, maintenanceReleasePerformed: false })
  expect(native.bank('talio_catalogs').get('live-tests').mongoVerificationAudit.blobOrphanTail).toEqual(native.context.blobOrphanTail)
  expect(native.context.blobOrphanTail.physicalClientUploadsDrained).toBe(false)
  for (const mutate of [
    audit => { delete audit.blobOrphanTail },
    audit => { audit.blobOrphanTail = { ...audit.blobOrphanTail, physicalClientUploadsDrained: true } },
  ]) {
    const denied = target(); denied.context = validateActivationEvidence(withBlobOrphanTail()); denied.audit = { ...denied.context }
    mutate(denied.audit)
    await expect(activateCatalog(denied)).rejects.toThrow('CURRENT_AUDITED_BLOB_ORPHAN_TAIL_REQUIRED')
    expect(denied.verifyParity).not.toHaveBeenCalled()
    expect(denied.bank('talio_catalogs').get('live-tests').applicationCutover).toBe(false)
  }
})

test('activation requires the same audited overlay and exact current cleaned counts before committing flags', async () => {
  const prepare = () => {
    const native = target(), proof = dispositionEvidence()
    native.context = validateActivationEvidence(proof); native.audit = { ...native.context }
    native.nativeDisposition = { report: proof.disposition, transform: value => value, assertComplete: jest.fn() }
    native.verifyParity.mockResolvedValue({ verified: true, mediaDisposition: proof.disposition, rawSourceIntegrityUnmodified: true, ...native.context.mediaDispositionCounts })
    return native
  }
  const accepted = prepare()
  await expect(activateCatalog(accepted)).resolves.toMatchObject({ activated: true, maintenanceReleasePerformed: false })
  expect(accepted.verifyParity).toHaveBeenCalledWith(accepted.db, accepted.entries, accepted.candidate, accepted.context.datasets, true, { nativeDisposition: accepted.nativeDisposition })
  for (const alter of [
    value => { delete value.nativeDisposition },
    value => { value.nativeDisposition = { ...value.nativeDisposition, report: { ...value.nativeDisposition.report, operationsHash: 'f'.repeat(64) } } },
    value => { value.verifyParity.mockResolvedValue({ verified: true, mediaDisposition: value.context.mediaDisposition, rawSourceIntegrityUnmodified: true, ...value.context.mediaDispositionCounts, omittedRecordCount: 999 }) },
    value => { value.verifyParity.mockResolvedValue({ verified: true }) },
  ]) {
    const denied = prepare(); alter(denied)
    await expect(activateCatalog(denied)).rejects.toThrow(/(?:CURRENT_AUDITED_MEDIA_DISPOSITION|CURRENT_CLEANED_NATIVE_PARITY)/)
    expect(denied.bank('talio_catalogs').get('live-tests').applicationCutover).toBe(false)
    expect(denied.bank('talio_migration_controls').get('write-fence').lastCatalogActivationHash).toBeUndefined()
  }
})

test('activation refuses missing fence, changed catalog, failed current parity and expired evidence', async () => {
  for (const alter of [
    native => { native.bank('talio_migration_controls').get('write-fence').active = false },
    native => { native.bank('talio_catalogs').get('live-tests').purpose = 'local-acceptance-only' },
    native => { native.bank('talio_catalogs').get('local-tests').purpose = 'production' },
    native => { native.verifyParity.mockResolvedValue({ verified: false }) },
    native => { native.context.sourceFenceExpiresAt = '2000-01-01T00:00:00Z' },
  ]) {
    const native = target(); alter(native)
    await expect(activateCatalog(native)).rejects.toThrow()
    expect(native.bank('talio_catalogs').get('live-tests').mongoVerified).toBe(false)
    expect(native.bank('talio_migration_controls').get('write-fence').lastCatalogActivationHash).toBeUndefined()
  }
})

test('concurrent fence release during commit aborts activation without partial flags', async () => {
  const native = target(), original = native.db.collection.bind(native.db)
  native.db.collection = name => name !== 'talio_migration_controls' ? original(name) : { ...original(name), updateOne: async () => ({ matchedCount: 0 }) }
  await expect(activateCatalog(native)).rejects.toThrow('FENCE_RELEASED')
  expect(native.bank('talio_catalogs').get('live-tests').applicationCutover).toBe(false)
})

test.each([1, 2, 3])('changed indexed archive fails closed at activation check %i without catalog writes', async check => {
  const native = target()
  let calls = 0
  native.entries.assertUnchanged = jest.fn(() => {
    if (++calls === check) throw new Error('ARCHIVE_FILE_CHANGED')
  })
  await expect(activateCatalog(native)).rejects.toThrow('ARCHIVE_FILE_CHANGED')
  expect(native.entries.assertUnchanged).toHaveBeenCalledTimes(check)
  expect(native.bank('talio_catalogs').get('live-tests')).toMatchObject({ applicationCutover: false, mongoVerified: false })
  expect(native.bank('talio_migration_controls').get('write-fence').lastCatalogActivationHash).toBeUndefined()
  if (check === 1) expect(native.verifyParity).not.toHaveBeenCalled()
})
