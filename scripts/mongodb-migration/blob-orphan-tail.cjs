'use strict'

const { canonical, sha256 } = require('./core.cjs')
const REVIEWED_SOURCE_REVISION = '9e36fe1546add7128589ae5cebf930bab11e787d'
const REVIEWED_SOURCE_HASHES = Object.freeze({
  'app/api/upload/token/route.js': 'a88d432da005f6d23bfe9f1e798929593b84da0d6ba03f72df80dadac2524e6f',
  'app/api/upload/prepare/route.js': '152c55ed92be407f84dbce9d6eb3954b4f0a1f77a908b2b5e00bbe7ad90e7243',
  'lib/client/uploadFile.js': '49d171b912484575257afa83de066615fee817507e0c455f589a63e53d25caf5',
  'lib/platform/blobStorage.server.js': 'b8c0ddbebd3fddefba28d8a937ecdabdc1fe4f424039da704f83ff769f6b28fd',
})
// UUID preparation describes the normal client, not an issuer path restriction:
// the issuer accepts a tenant prefix. Its enforced no-overwrite property is the
// invariant that protects every currently available retained object.
const REVIEWED_TOKEN_PROTOCOL = Object.freeze({ normalPreparationUsesNewUuidPath: true, tokenIssuerEnforcesTenantPrefix: true, allowOverwrite: false, uploadCompletionPersistsMetadata: false, clientDescriptorPersistenceRequiresSourceApi: true })
const TOKEN_PROTOCOL_REVIEW_HASH = sha256(canonical({ sourceRevision: REVIEWED_SOURCE_REVISION, sourceHashes: REVIEWED_SOURCE_HASHES, protocol: REVIEWED_TOKEN_PROTOCOL }))
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN

function validateBlobOrphanTail({ plane, fence, candidate, candidateManifestHash, sourceHash, media, mediaPlan, mediaVerificationReportHash, now = Date.now() }) {
  const tail = plane?.orphanTail, frozen = time(fence.writersFrozenSince), drained = time(fence.drainedAt), recorded = time(fence.recordedAt)
  const duringFence = value => Number.isFinite(time(value)) && time(value) >= frozen && time(value) <= drained
  // Immutable deployed-code forensics may finish after candidate export. This
  // is not a physical writer probe: require its real time in the recorded fence,
  // never backdate it into the earlier physical freeze/drain window.
  const reviewedBeforeRecording = value => Number.isFinite(recorded) && Number.isFinite(now) && recorded <= now && Number.isFinite(time(value)) && time(value) >= frozen && time(value) <= recorded
  const fail = () => { throw new Error('EXACT_PROVEN_BLOB_ORPHAN_ONLY_TAIL_REQUIRED') }
  if (plane?.blocked !== false || plane.inFlightDrained !== false || plane.orphanOnlyTail !== true || tail?.version !== 1 || tail.invariant !== 'append-only-unreferenced-client-upload-tail-v1' || tail.run !== candidate.run || tail.candidateManifestHash !== candidateManifestHash || tail.sourceHash !== sourceHash || tail.sourceProject !== 'talio-hrms' || candidate.sourceProject !== tail.sourceProject || tail.sourceDatabase !== '(default)' || candidate.sourceDatabase !== tail.sourceDatabase) fail()
  if (tail.sourceRevision !== REVIEWED_SOURCE_REVISION || canonical(tail.reviewedSourceHashes) !== canonical(REVIEWED_SOURCE_HASHES) || tail.tokenProtocolReviewHash !== TOKEN_PROTOCOL_REVIEW_HASH || canonical(tail.clientProtocol) !== canonical(REVIEWED_TOKEN_PROTOCOL)) fail()
  const deployment = tail.sourceDeployment
  if (deployment?.revision !== REVIEWED_SOURCE_REVISION || deployment.allTokenIssuersReviewed !== true || !hash(deployment.providerEvidenceHash) || !reviewedBeforeRecording(deployment.checkedAt)) fail()
  const metadata = tail.sourceMetadataWriterFence, dataPlane = fence.planes?.['firestore-data-principal']
  if (metadata?.positiveCatalogRead !== true || metadata.negativeMutationPermissionDenied !== true || metadata.projectWritePermissionsGranted !== 0 || !hash(metadata.probeReportHash) || dataPlane?.probeReportHash !== metadata.probeReportHash || dataPlane.blocked !== true || dataPlane.inFlightDrained !== true || !duringFence(metadata.checkedAt)) fail()
  const server = tail.serverBlobWriterFence
  if (server?.blocked !== true || server.inFlightDrained !== true || !hash(server.httpFenceProofHash) || !hash(server.cronFenceProofHash) || !duringFence(server.checkedAt) || time(server.checkedAt) < time(metadata.checkedAt)) fail()
  if (tail.physicalClientUploadsBlocked !== false || tail.physicalClientUploadsDrained !== false || tail.clientTokensExpired !== false || tail.orphanCleanupDeletionAuthorized !== false || tail.orphanCleanupPerformed !== false || tail.descriptorReplayPerformed !== false) fail()
  const retained = tail.retainedMedia, plan = mediaPlan.report
  // All ordinary media proof checks run before this helper. Bind that exact
  // fresh report and retained object set, not an independent availability claim.
  if (!hash(mediaVerificationReportHash) || retained?.mediaVerificationReportHash !== mediaVerificationReportHash || retained.referenceHash !== plan.referenceHash || retained.verifiedObjectsHash !== media.verifiedObjectsHash || retained.requiredObjects !== plan.requiredObjects || media.complete !== true || media.passed !== true || media.failedObjects !== 0 || media.objectsAvailable !== plan.requiredObjects || media.objectsRead !== plan.requiredObjects) fail()
  return { invariant: tail.invariant, sourceRevision: REVIEWED_SOURCE_REVISION, evidenceHash: sha256(canonical(tail)), sourceDeploymentEvidenceHash: deployment.providerEvidenceHash, sourceMetadataProbeHash: metadata.probeReportHash, mediaVerificationReportHash, tokenProtocolReviewHash: TOKEN_PROTOCOL_REVIEW_HASH, retainedReferenceHash: plan.referenceHash, retainedVerifiedObjectsHash: media.verifiedObjectsHash, orphanOnlyTail: true, physicalClientUploadsBlocked: false, physicalClientUploadsDrained: false, clientTokensExpired: false, orphanCleanupDeletionAuthorized: false, descriptorReplayPerformed: false }
}

module.exports = { validateBlobOrphanTail, REVIEWED_SOURCE_REVISION, REVIEWED_SOURCE_HASHES, REVIEWED_TOKEN_PROTOCOL, TOKEN_PROTOCOL_REVIEW_HASH }
