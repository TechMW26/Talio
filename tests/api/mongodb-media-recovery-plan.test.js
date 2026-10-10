const { sha256 } = require('../../scripts/mongodb-migration/core.cjs')
const { createMediaRecoveryPlan } = require('../../scripts/mongodb-migration/media-recovery-plan.cjs')
const original = '042abb3ca855dcb52fec8988d327e61670a0b9cc074a9d927a6047fe07d5ad11'
const hash = number => sha256(String(number))
const metadata = { run: 'mongo-offline-tests', datasets: ['live-example', 'local-example'], candidateManifestHash: hash(500), sourceHash: hash(501) }
function fixture({ truncated = false } = {}) {
  const objects = [
    { keyHash: hash(1), sha256: hash(100), length: 200, immutable: false, pathname: 'tenants/private-one/image' },
    { keyHash: hash(2), sha256: hash(100), length: 200, immutable: true, pathname: 'migrations/talio-hrms/private-backup' },
    { keyHash: hash(3), sha256: hash(100), length: 200, immutable: false, pathname: 'tenants/private-two/image' },
    { keyHash: hash(4), sha256: hash(100), length: 201, immutable: true, pathname: 'migrations/talio-hrms/private-wrong-length' },
    { keyHash: hash(5), sha256: hash(101), length: 200, immutable: true, pathname: 'migrations/talio-hrms/private-wrong-digest' },
    { keyHash: original, sha256: 'ad505f41a2fd0207184c5303ce06e23713e24f40ab3ac73674c037eefa89e46c', length: 76070, immutable: false, pathname: 'tenants/private-original/screenshot' },
  ]
  const plan = { objects, report: { descriptorPlanPassed: true, referenceHash: hash(502), embeddedBinaryRecords: 0 } }
  const prior = { command: 'verify', complete: true, ...metadata, datasets: [...metadata.datasets].reverse(), sourceHashVersion: 'canonical-sorted-collections-v1', descriptorPlanPassed: true, referenceHash: plan.report.referenceHash, requiredObjects: objects.length, objectsRead: objects.length, objectsAvailable: truncated ? 3 : 4, failedObjects: truncated ? 3 : 2, failures: [{ keyHash: hash(1), code: 'BLOB_OBJECT_UNAVAILABLE' }, { keyHash: original, code: 'BLOB_OBJECT_UNAVAILABLE' }], privateIgnoredUrl: 'https://private.example/secret' }
  const reportBytes = Buffer.from(JSON.stringify(prior))
  return { plan, prior, reportBytes, options: { ...metadata, expectedReportHash: sha256(reportBytes) } }
}
const invoke = data => createMediaRecoveryPlan(data.plan, data.reportBytes, data.options)
function changedPrior(data, patch) {
  const reportBytes = Buffer.from(JSON.stringify({ ...data.prior, ...patch }))
  return { ...data, reportBytes, options: { ...data.options, expectedReportHash: sha256(reportBytes) } }
}

test('offline plan matches exact checksum AND length across immutable/mutable categories; original is unmatched', () => {
  const data = fixture(), result = invoke(data)
  expect(result).toMatchObject({ providerReads: 0, mediaWrites: 0, sourceWrites: 0, recordedFailureKeys: 2, omittedFailureKeys: 0, completeFailureKeyCoverage: true, failuresWithCandidates: 1, failuresWithImmutableCandidates: 1, failuresWithMutableCandidates: 1, failuresWithoutCandidates: 1, descriptorMatchesOnly: true, candidateAvailability: 'unverified-no-provider-reads' })
  expect(result.rows.find(row => row.keyHash === hash(1))).toMatchObject({ sourceSha256: hash(100), length: 200, immutableCandidates: [hash(2)], mutableCandidates: [hash(3)] })
  expect(result.rows.find(row => row.keyHash === original)).toMatchObject({ length: 76070, immutableCandidates: [], mutableCandidates: [] })
  expect(JSON.stringify(result)).not.toMatch(/tenants\/|migrations\/|https:\/\/|private|secret|live-example|local-example/)
  expect(JSON.stringify(data.plan)).toContain('private-one') // Input was not mutated/redacted.
})

test('identifies retained old report truncation explicitly without reconstructing omitted identities', () => {
  const result = invoke(fixture({ truncated: true }))
  expect(result).toMatchObject({ totalFailedObjects: 3, recordedFailureKeys: 2, omittedFailureKeys: 1, completeFailureKeyCoverage: false })
  expect(result.rows).toHaveLength(2)
  expect(() => invoke(changedPrior(fixture({ truncated: true }), { omittedFailureKeys: 0 }))).toThrow('TRUNCATION_MISMATCH')
})

test.each([
  ['run', 'different-run'], ['sourceHash', hash(900)], ['candidateManifestHash', hash(901)],
  ['sourceHashVersion', 'unsupported'], ['complete', false], ['command', 'plan'],
])('fails closed when exact prior source binding %s mismatches', (key, value) => {
  expect(() => invoke(changedPrior(fixture(), { [key]: value }))).toThrow('SOURCE_BINDING_MISMATCH')
})

test('requires exact report bytes/hash and exact dataset allowlist', () => {
  const data = fixture()
  expect(() => invoke({ ...data, options: { ...data.options, expectedReportHash: hash(999) } })).toThrow('REPORT_HASH_REQUIRED')
  expect(() => invoke({ ...data, options: { ...data.options, datasets: ['live-example'] } })).toThrow('DATASET_SCOPE_MISMATCH')
  expect(() => invoke(changedPrior(data, { datasets: ['other-example'] }))).toThrow('DATASET_SCOPE_MISMATCH')
})

test('refuses conflicting descriptor metadata, changed reference hash and unscoped failure keys', () => {
  const data = fixture()
  expect(() => invoke({ ...data, plan: { ...data.plan, report: { ...data.plan.report, descriptorPlanPassed: false, conflictingDescriptors: 1 } } })).toThrow('DESCRIPTOR_OR_REFERENCE_MISMATCH')
  expect(() => invoke(changedPrior(data, { referenceHash: hash(998) }))).toThrow('REFERENCE_MISMATCH')
  expect(() => invoke(changedPrior(data, { failures: [{ keyHash: hash(997), code: 'BLOB_READ_FAILED' }] }))).toThrow('NOT_IN_SELECTED_SOURCE')
})

test('rejects duplicate/private error failures, impossible counts, and duplicate plan identities', () => {
  const data = fixture()
  expect(() => invoke(changedPrior(data, { failures: [data.prior.failures[0], data.prior.failures[0]] }))).toThrow('FAILURE_IDENTITY')
  expect(() => invoke(changedPrior(data, { failures: [{ keyHash: hash(1), code: 'secret provider URL' }] }))).toThrow('FAILURE_IDENTITY')
  expect(() => invoke(changedPrior(data, { failedObjects: 99 }))).toThrow('FAILURE_COUNTS')
  const objects = [...data.plan.objects]; objects[1] = { ...objects[1], keyHash: objects[0].keyHash }
  expect(() => invoke({ ...data, plan: { ...data.plan, objects } })).toThrow('OBJECT_IDENTITY')
})

test('known failed donors are excluded even if their content descriptor matches', () => {
  const data = fixture()
  const altered = changedPrior(data, { failures: [{ keyHash: hash(1), code: 'BLOB_READ_FAILED' }, { keyHash: hash(2), code: 'BLOB_READ_FAILED' }] })
  expect(invoke(altered).rows.find(row => row.keyHash === hash(1))).toMatchObject({ immutableCandidates: [], mutableCandidates: [hash(3)] })
})

test('large repeated content groups count every donor once but bound representative expansion per failure', () => {
  const data = fixture()
  const repeated = Array.from({ length: 800 }, (_, index) => ({ keyHash: hash(index + 10000), sha256: hash(100), length: 200, immutable: index % 2 === 0 }))
  const failed = Array.from({ length: 100 }, (_, index) => ({ keyHash: hash(index + 20000), sha256: hash(100), length: 200, immutable: false }))
  const objects = [...data.plan.objects, ...repeated, ...failed]
  const altered = changedPrior({ ...data, plan: { ...data.plan, objects } }, { requiredObjects: objects.length, objectsRead: objects.length, failedObjects: 102, objectsAvailable: objects.length - 102, failures: [...data.prior.failures, ...failed.map(object => ({ keyHash: object.keyHash, code: 'BLOB_READ_FAILED' }))] })
  const result = invoke(altered)
  expect(result).toMatchObject({ recordedFailureKeys: 102, failuresWithCandidates: 101, maximumCandidateKeysPerCategory: 16, completeCandidateKeyCoverage: false })
  const row = result.rows.find(row => row.keyHash === hash(1))
  expect(row).toMatchObject({ immutableCandidateCount: 401, mutableCandidateCount: 401, omittedImmutableCandidateKeys: 385, omittedMutableCandidateKeys: 385, completeCandidateKeyCoverage: false })
  expect(row.immutableCandidates).toHaveLength(16)
  expect(row.mutableCandidates).toHaveLength(16)
  expect(JSON.stringify(result).length).toBeLessThan(300000)
  expect(result.rows.find(value => value.keyHash === original)).toMatchObject({ immutableCandidateCount: 0, mutableCandidateCount: 0 })
})
