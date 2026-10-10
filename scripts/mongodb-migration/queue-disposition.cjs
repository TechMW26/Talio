'use strict'

// Offline acknowledgement validation only. No queue calls, data transformations,
// provider mutations, preservation claim, catalog activation or fence release.
const { canonical } = require('./core.cjs')
const { verifiedSourceEpoch } = require('./migrate.cjs')

const QUEUE_DISCARD_DECISION = 'discard-outstanding-source-queue-jobs'
const TALIO_VERCEL_PROJECT = 'prj_oeAvg1xGfwnBqG8G3LdI0n0PofDY'
const TALIO_VERCEL_TEAM = 'team_SrYNPxCVgIqvMkR0esfDUwj6'
const QUEUE_TOPICS = Object.freeze(['talio-background', 'talio-webhooks'])
const REQUIRED_QUEUE_FENCE_PLANES = Object.freeze(['cron-queue-workers', 'old-deployments', 'email-notification-side-effects', 'firestore-data-principal'])
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const revision = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN
const fail = code => { throw new Error(code) }
function datasets(values) {
  if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== 'string' || !/^[a-z][a-z0-9-]{7,79}$/.test(value)) || new Set(values).size !== values.length) fail('QUEUE_DISPOSITION_DATASETS_INVALID')
  return [...values].sort()
}

function validateQueueDisposition({ evidence, evidenceHash, expected, fence, now = Date.now() }) {
  if (!evidence || !expected || !fence || !hash(evidenceHash)) fail('EXPLICIT_QUEUE_DISPOSITION_EVIDENCE_REQUIRED')
  if (evidence.version !== 1 || evidence.decision !== QUEUE_DISCARD_DECISION || evidence.userAuthorization !== QUEUE_DISCARD_DECISION || !hash(evidence.authorizationMessageHash) || evidence.unknownOutstandingCountAccepted !== true || evidence.outstandingJobCount !== null || evidence.preservationVerified !== false || evidence.businessDataDeletionAuthorized !== false || evidence.queueReplayAuthorized !== false) fail('EXACT_USER_AUTHORIZED_QUEUE_DISCARD_REQUIRED')
  if (evidence.vercelProjectId !== TALIO_VERCEL_PROJECT || evidence.vercelTeamId !== TALIO_VERCEL_TEAM || evidence.environment !== 'production' || canonical(evidence.topics) !== canonical(QUEUE_TOPICS)) fail('EXACT_TALIO_SOURCE_QUEUE_SCOPE_REQUIRED')
  if (!/^[a-z][a-z0-9-]{7,79}$/.test(expected.run || '') || !hash(expected.candidateManifestHash) || !hash(expected.sourceHash) || !hash(expected.sourceFenceEvidenceHash) || evidence.run !== expected.run || evidence.candidateManifestHash !== expected.candidateManifestHash || evidence.sourceHash !== expected.sourceHash || evidence.sourceFenceEvidenceHash !== expected.sourceFenceEvidenceHash || evidence.sourceProject !== expected.sourceProject || evidence.sourceDatabase !== expected.sourceDatabase || canonical(datasets(evidence.datasets)) !== canonical(datasets(expected.datasets)) || canonical(evidence.target) !== canonical(expected.target)) fail('BOUND_FINAL_QUEUE_DISPOSITION_REQUIRED')
  const frozen = timestamp(fence.writersFrozenSince), drained = timestamp(fence.drainedAt), expires = timestamp(fence.expiresAt)
  const sourceVerificationEpoch = verifiedSourceEpoch(expected.sourceVerification, expected, now)
  const authorized = timestamp(evidence.authorizedAt), recorded = timestamp(evidence.recordedAt), candidateStarted = timestamp(sourceVerificationEpoch.startedAt)
  if (!Number.isFinite(authorized) || !Number.isFinite(recorded) || authorized > recorded || recorded > now || fence.active !== true || !Number.isFinite(frozen) || !Number.isFinite(drained) || drained < frozen || !Number.isFinite(candidateStarted) || drained > candidateStarted || recorded < drained || !Number.isFinite(expires) || expires <= now || fence.candidateRun !== expected.run || fence.candidateManifestHash !== expected.candidateManifestHash || fence.sourceHash !== expected.sourceHash || fence.sourceProject !== expected.sourceProject || fence.sourceDatabase !== expected.sourceDatabase || canonical(datasets(fence.datasets)) !== canonical(datasets(expected.datasets))) fail('QUEUE_DISCARD_STILL_REQUIRES_BOUND_ACTIVE_SOURCE_FENCE')
  for (const plane of REQUIRED_QUEUE_FENCE_PLANES) {
    const check = fence.planes?.[plane], checked = timestamp(check?.checkedAt)
    if (check?.blocked !== true || check.inFlightDrained !== true || typeof check.method !== 'string' || check.method.trim().length < 8 || check.method.length > 500 || !Number.isFinite(checked) || checked < frozen || checked > drained) fail('QUEUE_DISCARD_STILL_REQUIRES_BLOCKED_DRAINED_WRITERS')
  }
  const isolation = evidence.targetQueueIsolation
  if (!isolation || !/^dpl_[A-Za-z0-9]+$/.test(isolation.deploymentId || '') || !/^dpl_[A-Za-z0-9]+$/.test(isolation.oldProductionDeploymentId || '') || isolation.deploymentId === isolation.oldProductionDeploymentId || isolation.freshDeploymentVerified !== true || isolation.defaultDeploymentPinning !== true || isolation.deploymentlessRuntimePollingEnabled !== false || isolation.archivedJobsReplayed !== false || !revision(isolation.runtimeRevision) || !hash(isolation.providerDeploymentEvidenceHash) || !hash(isolation.runtimeQueueAuditHash) || !Number.isFinite(timestamp(isolation.verifiedAt)) || timestamp(isolation.verifiedAt) < frozen || timestamp(isolation.verifiedAt) > recorded) fail('NEW_DEPLOYMENT_QUEUE_PARTITION_ISOLATION_REQUIRED')
  // This records an explicit risk decision. It does NOT stand in for the other
  // source planes, current Mongo parity, media verification or target maintenance.
  return {
    version: 1, decision: evidence.decision, userAuthorization: evidence.userAuthorization, authorizationMessageHash: evidence.authorizationMessageHash, reportHash: evidenceHash,
    run: evidence.run, candidateManifestHash: evidence.candidateManifestHash, sourceHash: evidence.sourceHash, sourceFenceEvidenceHash: evidence.sourceFenceEvidenceHash,
    sourceProject: evidence.sourceProject, sourceDatabase: evidence.sourceDatabase, datasets: datasets(evidence.datasets), target: evidence.target,
    vercelProjectId: evidence.vercelProjectId, vercelTeamId: evidence.vercelTeamId, environment: evidence.environment, topics: [...QUEUE_TOPICS],
    outstandingJobCount: null, unknownOutstandingCountAccepted: true, preservationVerified: false, businessDataDeletionAuthorized: false, queueReplayAuthorized: false,
    targetQueueIsolation: { ...isolation }, acknowledgementValidated: true, maintenanceReleasePerformed: false,
    sourceVerificationEpoch,
  }
}

module.exports = { QUEUE_DISCARD_DECISION, TALIO_VERCEL_PROJECT, TALIO_VERCEL_TEAM, QUEUE_TOPICS, REQUIRED_QUEUE_FENCE_PLANES, validateQueueDisposition }
