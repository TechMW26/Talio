#!/usr/bin/env node
'use strict'

// Explicit offline diagnostic. The only mutation-shaped request has an
// impossible updateTime precondition. This does not claim a source-wide fence.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { PROJECT, EXPECTED, WRITE_PROBES, READ_PROBES } = require('./source-freeze-policy.cjs')
const DATASET = 'live-firestore-20261004-01'
const DATABASE = '(default)'
const EPOCH = '1970-01-01T00:00:00Z'
const DOCUMENT = `projects/${PROJECT}/databases/${DATABASE}/documents/talioDatasets/${DATASET}`
const DOCUMENT_URL = `https://firestore.googleapis.com/v1/${DOCUMENT}`
const COMMIT_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents:commit`
const IAM_URL = `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:testIamPermissions`
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

function validateSourceCredential(env) {
  if (env.FIRESTORE_PROJECT_ID !== PROJECT || (env.FIRESTORE_DATABASE_ID || DATABASE) !== DATABASE || env.FIRESTORE_DATASET !== DATASET || env.FIRESTORE_EMULATOR_HOST) throw new Error('EXACT_CLOUD_SOURCE_CATALOG_REQUIRED')
  let credential
  try { credential = JSON.parse(env.FIRESTORE_SERVICE_ACCOUNT_JSON) } catch { throw new Error('EXPLICIT_SOURCE_SERVICE_ACCOUNT_REQUIRED') }
  if (credential?.type !== 'service_account' || `serviceAccount:${credential.client_email}` !== EXPECTED['roles/datastore.user'] || typeof credential.private_key !== 'string' || !credential.private_key.includes('BEGIN PRIVATE KEY')) throw new Error('EXACT_SOURCE_DATA_PRINCIPAL_REQUIRED')
  return credential
}

function impossibleCommit(document) {
  // Firestore updateTime requires an existing document with that exact last
  // update time. A document read from this source was created after 2000. If it
  // is subsequently deleted or recreated, the epoch condition still cannot
  // become true. No transforms, deletes, creates or caller-selected paths.
  const updated = Date.parse(document?.updateTime)
  if (document?.name !== DOCUMENT || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(document?.updateTime || '') || !Number.isFinite(updated) || updated < Date.parse('2000-01-01T00:00:00Z')) throw new Error('POSITIVE_EXACT_CATALOG_READ_REQUIRED')
  return { writes: [{ update: { name: DOCUMENT, fields: {} }, currentDocument: { updateTime: EPOCH } }] }
}

async function probeSourceFreeze({ request, now = () => new Date().toISOString() }) {
  const read = await request(DOCUMENT_URL, { method: 'GET' })
  if (read.status !== 200 || !/^[a-f0-9]{64}$/.test(read.hash || '')) throw new Error('POSITIVE_SOURCE_READ_NOT_VERIFIED')
  const commit = impossibleCommit(read.body)
  const permissions = [...new Set([...WRITE_PROBES, ...READ_PROBES])]
  const iam = await request(IAM_URL, { method: 'POST', body: { permissions } })
  const returned = iam.body?.permissions === undefined ? [] : iam.body.permissions
  if (iam.status !== 200 || !iam.body || typeof iam.body !== 'object' || Array.isArray(iam.body) || !Array.isArray(returned) || returned.some(item => !permissions.includes(item)) || new Set(returned).size !== returned.length) throw new Error('PROJECT_PERMISSION_PROBE_NOT_VERIFIED')
  const granted = iam.body.permissions || []
  const negative = await request(COMMIT_URL, { method: 'POST', body: commit })
  const denied = negative.status === 403 && negative.body?.error?.status === 'PERMISSION_DENIED'
  const preconditionOnly = negative.status === 400 && negative.body?.error?.status === 'FAILED_PRECONDITION'
  const writePermissionsGranted = WRITE_PROBES.filter(permission => granted.includes(permission)).length
  return {
    version: 1, command: 'probe-source-freeze', sourceProject: PROJECT, sourceDatabase: DATABASE,
    catalogHash: sha256(DOCUMENT), principalHash: sha256(EXPECTED['roles/datastore.user']),
    verifiedAt: now(), positiveCatalogRead: true, sourceResponseHash: read.hash,
    projectPermissionsTested: permissions.length, projectPermissionsGranted: granted.length,
    projectWritePermissionsGranted: writePermissionsGranted,
    projectReadPermissionsGranted: READ_PROBES.filter(permission => granted.includes(permission)).length,
    impossiblePreconditionUsed: true, negativeMutationHttpStatus: negative.status,
    negativeMutationPermissionDenied: denied, preconditionFailureOnly: preconditionOnly,
    passed: denied && writePermissionsGranted === 0,
    actualSourceWritesPerformed: denied || preconditionOnly ? 0 : null, sourceWideFreezeVerified: false,
    inheritedConditionalDatabaseGrantsRequireReview: true,
  }
}

async function protectedBytes(file) {
  if (!path.isAbsolute(file)) throw new Error('ABSOLUTE_PROTECTED_ENV_PATH_REQUIRED')
  const handle = await fsp.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > 2 * 1024 * 1024) throw new Error('OWNED_PRIVATE_ENV_FILE_REQUIRED')
    return await handle.readFile()
  } finally { await handle.close() }
}

async function main() {
  process.umask(0o077)
  const flags = {}
  for (const arg of process.argv.slice(2)) {
    if (arg === '--execute' && !flags.execute) { flags.execute = true; continue }
    const match = /^--(env-file|report)=([^=]+)$/.exec(arg)
    if (!match || flags[match[1]]) throw new Error('INVALID_OR_DUPLICATE_PROBE_FLAG')
    flags[match[1]] = match[2]
  }
  if (!flags['env-file']) throw new Error('EXPLICIT_PROTECTED_SOURCE_ENV_FILE_REQUIRED')
  const env = require('dotenv').parse(await protectedBytes(flags['env-file']))
  const credential = validateSourceCredential(env)
  if (!flags.execute) {
    console.log(JSON.stringify({ command: 'source-freeze-probe-plan', providerRequests: 0, actualSourceWritesPerformed: 0, exactCatalogBound: true, unsatisfiablePreconditionOnly: true }))
    return
  }
  if (!flags.report || !path.isAbsolute(flags.report)) throw new Error('ABSOLUTE_PRIVATE_REPORT_PATH_REQUIRED')
  // Require a fresh report path before any requests; never truncate old proof.
  const handle = await fsp.open(flags.report, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
  try {
    const { JWT } = require('google-auth-library')
    const auth = new JWT({ email: credential.client_email, key: credential.private_key, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
    const tokenResult = await auth.getAccessToken(), token = typeof tokenResult === 'string' ? tokenResult : tokenResult?.token
    if (!token) throw new Error('SOURCE_AUTHENTICATION_FAILED')
    const request = async (url, options) => {
      if (![DOCUMENT_URL, IAM_URL, COMMIT_URL].includes(url)) throw new Error('UNEXPECTED_SOURCE_PROBE_ENDPOINT')
      const response = await fetch(url, { method: options.method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(options.body ? { body: JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(30000), redirect: 'error' })
      const length = Number(response.headers.get('content-length'))
      if (length > 2 * 1024 * 1024) throw new Error('SOURCE_PROBE_RESPONSE_TOO_LARGE')
      const chunks = [], reader = response.body.getReader()
      let received = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          received += value.byteLength
          if (received > 2 * 1024 * 1024) throw new Error('SOURCE_PROBE_RESPONSE_TOO_LARGE')
          chunks.push(Buffer.from(value))
        }
      } finally { await reader.cancel() }
      const bytes = Buffer.concat(chunks)
      let body
      try { body = JSON.parse(bytes) } catch { throw new Error('SOURCE_PROBE_RESPONSE_INVALID') }
      return { status: response.status, body, hash: sha256(bytes) }
    }
    const report = await probeSourceFreeze({ request })
    await handle.writeFile(JSON.stringify(report, null, 2)); await handle.sync()
    console.log(JSON.stringify({ command: report.command, passed: report.passed, positiveCatalogRead: true, projectWritePermissionsGranted: report.projectWritePermissionsGranted, negativeMutationPermissionDenied: report.negativeMutationPermissionDenied, negativeMutationHttpStatus: report.negativeMutationHttpStatus, actualSourceWritesPerformed: report.actualSourceWritesPerformed, sourceWideFreezeVerified: false }))
    if (!report.passed) process.exitCode = 1
  } finally { await handle.close() }
}

if (require.main === module) main().catch(() => { console.error(JSON.stringify({ command: 'source-freeze-probe-failed', privateDetailsOmitted: true, sourceWideFreezeVerified: false })); process.exitCode = 1 })
module.exports = { validateSourceCredential, impossibleCommit, probeSourceFreeze, DOCUMENT, DATASET, DATABASE, EPOCH, DOCUMENT_URL, COMMIT_URL, IAM_URL }
