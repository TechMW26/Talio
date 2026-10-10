const fs = require('node:fs')
const path = require('node:path')
const { QUEUE_DISCARD_DECISION, TALIO_VERCEL_PROJECT, TALIO_VERCEL_TEAM, QUEUE_TOPICS, REQUIRED_QUEUE_FENCE_PLANES, validateQueueDisposition } = require('../../scripts/mongodb-migration/queue-disposition.cjs')
const { SOURCE_VERIFICATION_EPOCH_PROTOCOL } = require('../../scripts/mongodb-migration/migrate.cjs')

function proof() {
  const now = Date.now(), at = offset => new Date(now + offset).toISOString()
  const expected = { run: 'mongo-final-queue-tests', candidateManifestHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64), sourceFenceEvidenceHash: 'c'.repeat(64), sourceProject: 'talio-hrms', sourceDatabase: '(default)', datasets: ['live-tests', 'local-tests'], target: { host: 'cluster.example.test', databaseName: 'talio' }, candidateStartedAt: at(-30000) }
  const fence = { version: 1, active: true, candidateRun: expected.run, candidateManifestHash: expected.candidateManifestHash, sourceHash: expected.sourceHash, sourceProject: expected.sourceProject, sourceDatabase: expected.sourceDatabase, datasets: expected.datasets, writersFrozenSince: at(-120000), drainedAt: at(-60000), expiresAt: at(3600000), planes: Object.fromEntries(REQUIRED_QUEUE_FENCE_PLANES.map(plane => [plane, { blocked: true, inFlightDrained: true, method: 'independent data plane denial and drained invocations', checkedAt: at(-90000) }])) }
  const evidence = { ...expected, version: 1, decision: QUEUE_DISCARD_DECISION, userAuthorization: QUEUE_DISCARD_DECISION, authorizationMessageHash: 'd'.repeat(64), authorizedAt: at(-180000), recordedAt: at(-10000), vercelProjectId: TALIO_VERCEL_PROJECT, vercelTeamId: TALIO_VERCEL_TEAM, environment: 'production', topics: [...QUEUE_TOPICS], outstandingJobCount: null, unknownOutstandingCountAccepted: true, preservationVerified: false, businessDataDeletionAuthorized: false, queueReplayAuthorized: false,
    targetQueueIsolation: { deploymentId: 'dpl_newMongo', oldProductionDeploymentId: 'dpl_oldSource', freshDeploymentVerified: true, defaultDeploymentPinning: true, deploymentlessRuntimePollingEnabled: false, archivedJobsReplayed: false, runtimeRevision: 'e'.repeat(40), providerDeploymentEvidenceHash: 'f'.repeat(64), runtimeQueueAuditHash: '1'.repeat(64), verifiedAt: at(-20000) } }
  return { evidence, evidenceHash: '2'.repeat(64), expected, fence, now }
}

test('explicit queue-only disposition records unknown loss without authorizing business-data deletion/replay', () => {
  const input = proof(), before = JSON.stringify(input)
  expect(validateQueueDisposition(input)).toMatchObject({ decision: QUEUE_DISCARD_DECISION, outstandingJobCount: null, preservationVerified: false, businessDataDeletionAuthorized: false, queueReplayAuthorized: false, acknowledgementValidated: true, maintenanceReleasePerformed: false, run: input.expected.run, reportHash: input.evidenceHash })
  expect(JSON.stringify(input)).toBe(before)
  expect(validateQueueDisposition(input)).not.toHaveProperty('complete')
  expect(validateQueueDisposition(input)).not.toHaveProperty('allBusinessDataPreserved')
})

function verifiedSnapshotProof() {
  const input = proof(), at = offset => new Date(input.now + offset).toISOString()
  input.expected.candidateExportFinishedAt = at(-25000)
  input.expected.sourceCounts = { collectionsVerified: 2, documentsVerified: 3, missingParentsVerified: 1 }
  input.expected.sourceVerification = { run: input.expected.run, candidateManifestHash: input.expected.candidateManifestHash, sourceHash: input.expected.sourceHash, sourceHashVersion: 'canonical-sorted-collections-v1', sourceProject: input.expected.sourceProject, sourceDatabase: input.expected.sourceDatabase, datasets: [...input.expected.datasets], complete: true, unchangedAtRead: true, verificationProtocol: SOURCE_VERIFICATION_EPOCH_PROTOCOL, verificationStartedAt: at(-15000), verifiedAt: at(-12000), fullBodiesRead: true, fullTopologyVerified: true, metadataUpdateTimesVerified: true, noReuse: true, reusedDocuments: 0, archiveUnchanged: true, ...input.expected.sourceCounts }
  input.fence.drainedAt = at(-20000)
  return input
}

test('post-retirement full source pass validates later drain without changing candidate start or claiming preservation', () => {
  const input = verifiedSnapshotProof(), original = input.expected.candidateStartedAt
  expect(validateQueueDisposition(input)).toMatchObject({ sourceVerificationEpoch: { mode: SOURCE_VERIFICATION_EPOCH_PROTOCOL, startedAt: input.expected.sourceVerification.verificationStartedAt }, preservationVerified: false })
  expect(input.expected.candidateStartedAt).toBe(original)
  delete input.expected.sourceVerification
  expect(() => validateQueueDisposition(input)).toThrow('BOUND_ACTIVE_SOURCE_FENCE')
})

test.each([
  input => { delete input.expected.sourceVerification.noReuse },
  input => { input.expected.sourceVerification.fullBodiesRead = false },
  input => { input.expected.sourceVerification.fullTopologyVerified = false },
  input => { input.expected.sourceVerification.reusedDocuments = 1 },
  input => { input.expected.sourceVerification.verificationStartedAt = input.expected.candidateStartedAt },
  input => { input.expected.sourceVerification.verificationStartedAt = new Date(input.now + 1).toISOString() },
  input => { input.expected.sourceVerification.verificationStartedAt = 'invalid' },
  input => { input.expected.sourceVerification.candidateManifestHash = 'f'.repeat(64) },
  input => { input.expected.sourceVerification.datasets = ['foreign-tests'] },
  input => { input.expected.sourceVerification.documentsVerified++ },
])('queue gate cannot accept a forged/partial/reused verification epoch (%#)', change => {
  const input = verifiedSnapshotProof(); change(input)
  expect(() => validateQueueDisposition(input)).toThrow('FULL_SOURCE_VERIFICATION_EPOCH')
})

test.each([
  value => { delete value.evidence },
  value => { value.evidenceHash = 'invalid' },
  value => { value.evidence.decision = 'delete-any-data' },
  value => { value.evidence.userAuthorization = 'proceed-unspecified' },
  value => { value.evidence.authorizationMessageHash = 'missing' },
  value => { value.evidence.unknownOutstandingCountAccepted = false },
  value => { value.evidence.outstandingJobCount = 0 },
  value => { value.evidence.preservationVerified = true },
  value => { value.evidence.businessDataDeletionAuthorized = true },
  value => { value.evidence.queueReplayAuthorized = true },
  value => { value.evidence.environment = 'preview' },
  value => { value.evidence.vercelProjectId = 'other-project' },
  value => { value.evidence.vercelTeamId = 'other-team' },
  value => { value.evidence.topics.push('other') },
  value => { value.evidence.authorizedAt = new Date(value.now + 1).toISOString() },
])('fails closed on missing/broad authorization or invented preservation (%#)', change => {
  const input = proof(); change(input)
  expect(() => validateQueueDisposition(input)).toThrow()
})

test.each(['run', 'candidateManifestHash', 'sourceHash', 'sourceFenceEvidenceHash', 'sourceProject', 'sourceDatabase', 'datasets', 'target'])('cannot reuse queue disposition for another final %s', key => {
  const input = proof()
  input.evidence[key] = key === 'datasets' ? ['foreign-tests'] : key === 'target' ? { host: 'other.example', databaseName: 'other' } : 'foreign'
  expect(() => validateQueueDisposition(input)).toThrow('BOUND_FINAL_QUEUE_DISPOSITION')
})

test.each(REQUIRED_QUEUE_FENCE_PLANES)('approved discard still requires blocked and actually drained %s', plane => {
  for (const status of ['missing', 'unblocked', 'in-flight', 'outside-window']) {
    const input = proof()
    if (status === 'missing') delete input.fence.planes[plane]
    else if (status === 'unblocked') input.fence.planes[plane].blocked = false
    else if (status === 'in-flight') input.fence.planes[plane].inFlightDrained = false
    else input.fence.planes[plane].checkedAt = new Date(input.now).toISOString()
    expect(() => validateQueueDisposition(input)).toThrow('BLOCKED_DRAINED_WRITERS')
  }
})

test.each([
  value => { value.fence.active = false },
  value => { value.fence.expiresAt = new Date(value.now - 1).toISOString() },
  value => { value.fence.candidateRun = 'other-run' },
  value => { value.fence.drainedAt = new Date(value.now).toISOString() },
  value => { value.fence.writersFrozenSince = 'invalid' },
])('disposition is never a substitute for an active exact source fence (%#)', change => {
  const input = proof(); change(input)
  expect(() => validateQueueDisposition(input)).toThrow('BOUND_ACTIVE_SOURCE_FENCE')
})

test.each([
  value => { value.deploymentId = value.oldProductionDeploymentId },
  value => { value.freshDeploymentVerified = false },
  value => { value.defaultDeploymentPinning = false },
  value => { value.deploymentlessRuntimePollingEnabled = true },
  value => { value.archivedJobsReplayed = true },
  value => { value.runtimeRevision = 'unverified' },
  value => { value.providerDeploymentEvidenceHash = '' },
  value => { value.runtimeQueueAuditHash = '' },
  value => { value.verifiedAt = 'invalid' },
])('new Mongo runtime must not consume old source partitions (%#)', change => {
  const input = proof(); change(input.evidence.targetQueueIsolation)
  expect(() => validateQueueDisposition(input)).toThrow('QUEUE_PARTITION_ISOLATION')
})

test('actual runtime keeps SDK default pinning; offline archival polling is not imported into runtime', () => {
  const root = path.resolve(__dirname, '../..'), config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'))
  expect(config.functions['app/api/queues/background/route.js'].experimentalTriggers).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'queue/v2beta', topic: 'talio-background' })]))
  expect(config.functions['app/api/queues/webhooks/route.js'].experimentalTriggers).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'queue/v2beta', topic: 'talio-webhooks' })]))
  const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path.join(directory, entry.name)] : [])
  const queueFiles = []
  for (const filename of [...walk(path.join(root, 'app')), ...walk(path.join(root, 'lib'))]) {
    const source = fs.readFileSync(filename, 'utf8')
    expect(source).not.toMatch(/(?:from\s*|require\(\s*|import\(\s*)['"][^'"]*archive-queues\.cjs['"]|\bPollingQueueClient\b/)
    if (/['"]@vercel\/queue['"]/.test(source)) {
      queueFiles.push(path.relative(root, filename))
      expect(source).not.toMatch(/\bdeploymentId\s*:|Vqs-Deployment-Id|\bresolveBaseUrl\s*:/)
    }
  }
  expect(queueFiles.sort()).toEqual(['app/api/queues/webhooks/route.js', 'lib/platform/firestoreBackgroundJobs.server.js', 'lib/webhookDispatcher.js'])
})
