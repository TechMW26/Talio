const {
  validateSourceCredential, impossibleCommit, probeSourceFreeze,
  DOCUMENT, DATASET, EPOCH, DOCUMENT_URL, COMMIT_URL, IAM_URL,
} = require('../../scripts/mongodb-migration/probe-source-freeze.cjs')
const { EXPECTED } = require('../../scripts/mongodb-migration/source-freeze-policy.cjs')
const sourceEnv = () => ({ FIRESTORE_PROJECT_ID: 'talio-hrms', FIRESTORE_DATABASE_ID: '(default)', FIRESTORE_DATASET: DATASET, FIRESTORE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account', client_email: EXPECTED['roles/datastore.user'].slice('serviceAccount:'.length), private_key: '-----BEGIN PRIVATE KEY-----\nsynthetic-only\n-----END PRIVATE KEY-----' }) })
const catalog = () => ({ name: DOCUMENT, updateTime: '2026-10-10T00:00:00.123456Z', fields: { confidential: { stringValue: 'must-not-appear-in-report' } } })

test('credential allowlist binds exact source project, database, dataset and existing source SA', () => {
  expect(validateSourceCredential(sourceEnv()).type).toBe('service_account')
  for (const mutation of [
    env => { env.FIRESTORE_PROJECT_ID = 'other' },
    env => { env.FIRESTORE_DATABASE_ID = 'other' },
    env => { env.FIRESTORE_DATASET = 'other' },
    env => { env.FIRESTORE_EMULATOR_HOST = 'localhost' },
    env => { env.FIRESTORE_SERVICE_ACCOUNT_JSON = '{' },
    env => { env.FIRESTORE_SERVICE_ACCOUNT_JSON = JSON.stringify({ type: 'service_account', client_email: 'other@other.iam.gserviceaccount.com', private_key: 'BEGIN PRIVATE KEY' }) },
  ]) {
    const env = sourceEnv(); mutation(env)
    expect(() => validateSourceCredential(env)).toThrow()
  }
})

test('only exact positively read catalog generates one structurally impossible update, without transforms or data', () => {
  expect(impossibleCommit(catalog())).toEqual({ writes: [{ update: { name: DOCUMENT, fields: {} }, currentDocument: { updateTime: EPOCH } }] })
  for (const document of [null, {}, { ...catalog(), name: `${DOCUMENT}/other` }, { ...catalog(), updateTime: EPOCH }, { ...catalog(), updateTime: 'invalid' }]) expect(() => impossibleCommit(document)).toThrow()
})

function mockRequest({ readStatus = 200, readBody = catalog(), iamStatus = 200, iamBody = {}, mutationStatus = 403, mutationBody = { error: { status: 'PERMISSION_DENIED', message: 'private-provider-message' } } } = {}) {
  return jest.fn(async (url) => {
    if (url === DOCUMENT_URL) return { status: readStatus, body: readBody, hash: 'a'.repeat(64) }
    if (url === IAM_URL) return { status: iamStatus, body: iamBody }
    if (url === COMMIT_URL) return { status: mutationStatus, body: mutationBody }
    throw new Error('unexpected endpoint')
  })
}

test('performs positive read, permission inventory, then safe denial and never claims all-writer proof', async () => {
  const request = mockRequest({ iamBody: { permissions: ['datastore.entities.get', 'datastore.entities.list', 'datastore.databases.get'] } })
  const report = await probeSourceFreeze({ request, now: () => '2026-10-10T01:00:00Z' })
  expect(request.mock.calls.map(call => call[0])).toEqual([DOCUMENT_URL, IAM_URL, COMMIT_URL])
  expect(request.mock.calls[2][1]).toEqual({ method: 'POST', body: impossibleCommit(catalog()) })
  expect(report).toMatchObject({ passed: true, positiveCatalogRead: true, projectWritePermissionsGranted: 0, negativeMutationPermissionDenied: true, sourceWideFreezeVerified: false, actualSourceWritesPerformed: 0 })
  expect(JSON.stringify(report)).not.toMatch(/must-not-appear|private-provider-message|talioDatasets/)
})

test('remaining project write permissions fail gate despite a denied commit', async () => {
  const report = await probeSourceFreeze({ request: mockRequest({ iamBody: { permissions: ['datastore.entities.update'] } }) })
  expect(report).toMatchObject({ passed: false, projectWritePermissionsGranted: 1, negativeMutationPermissionDenied: true })
})

test.each([
  [400, 'FAILED_PRECONDITION', true, 0],
  [401, 'UNAUTHENTICATED', false, null],
  [403, 'UNAUTHENTICATED', false, null],
  [500, 'INTERNAL', false, null],
  [200, undefined, false, null],
])('does not confuse HTTP %s / %s with a verified permission denial', async (status, code, preconditionOnly, writes) => {
  const report = await probeSourceFreeze({ request: mockRequest({ mutationStatus: status, mutationBody: code ? { error: { status: code } } : {} }) })
  expect(report).toMatchObject({ passed: false, negativeMutationPermissionDenied: false, preconditionFailureOnly: preconditionOnly, actualSourceWritesPerformed: writes })
})

test.each([
  { readStatus: 403 }, { readBody: { ...catalog(), updateTime: EPOCH } },
  { iamStatus: 403 }, { iamBody: null }, { iamBody: { permissions: 'invalid' } },
  { iamBody: { permissions: null } }, { iamBody: { permissions: ['unknown.permission'] } },
  { iamBody: { permissions: ['datastore.entities.get', 'datastore.entities.get'] } },
])('never issues mutation probe after failed positive read or permission inventory %j', async options => {
  const request = mockRequest(options)
  await expect(probeSourceFreeze({ request })).rejects.toThrow()
  expect(request.mock.calls.some(call => call[0] === COMMIT_URL)).toBe(false)
})

test('offline probe must never become a runtime lifecycle entrypoint', () => {
  const { inspectSource, inspectPackageScripts } = require('../../scripts/firestore-migration/audit-runtime.cjs')
  expect(inspectSource('scripts/mongodb-migration/probe-source-freeze.cjs', "fetch('https://firestore.googleapis.com')")).toBeNull()
  expect(inspectSource('app/api/probe/route.js', "fetch('https://firestore.googleapis.com')")).not.toBeNull()
  expect(inspectPackageScripts({ start: 'node scripts/mongodb-migration/probe-source-freeze.cjs' })).toHaveLength(1)
})
