'use strict'

// Additive-only admin tool. Credentials are read from the repository .env, never
// the Firebase CLI login or ambient Application Default Credentials.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const ROOT = path.resolve(__dirname, '../..')
const PROJECT = 'talio-hrms'
const APPROVED_PRINCIPAL = 'firebase-adminsdk-fbsvc@talio-hrms-d6239.iam.gserviceaccount.com'
const PARENT = `projects/${PROJECT}/databases/(default)/collectionGroups/records`
const INDEX_URL = `https://firestore.googleapis.com/v1/${PARENT}/indexes`
const IAM_URL = `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:testIamPermissions`
const PERMISSIONS = ['datastore.indexes.list', 'datastore.indexes.create']
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const statusOf = error => Number(error?.response?.status || error?.status || error?.code) || null
const fail = (message, status) => Object.assign(new Error(message), { safeMessage: message, status })

function providerFailure(error) {
  const body = error?.response?.data?.error
  const result = { status: statusOf(error) }
  if (!body || typeof body !== 'object') return result
  if (typeof body.status === 'string' && /^[A-Z_]{1,80}$/.test(body.status)) result.providerStatus = body.status
  const reasons = (Array.isArray(body.details) ? body.details : []).map(detail => detail?.reason).filter(reason => typeof reason === 'string' && /^[A-Z_]{1,100}$/.test(reason))
  if (reasons.length) result.reasons = [...new Set(reasons)]
  if (typeof body.message === 'string') {
    // Only the administrative API's structured message is considered, never
    // error.message/request/config/headers. Redact the entire message if it
    // resembles credential material, rather than risk partial token removal.
    const sensitive = /private[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|authorization|bearer\s|token\s*[=:]|AIza[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Za-z0-9_+/=-]{100,}/i
    result.message = sensitive.test(body.message) ? '[redacted provider message]' : body.message.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 500)
  }
  return result
}

function indexShape(index) {
  return { queryScope: index.queryScope, apiScope: index.apiScope || 'ANY_API', fields: (index.fields || []).map(field => ({ fieldPath: field.fieldPath, ...(field.order ? { order: field.order } : {}), ...(field.arrayConfig ? { arrayConfig: field.arrayConfig } : {}), ...(field.vectorConfig ? { vectorConfig: field.vectorConfig } : {}) })) }
}
const signature = index => JSON.stringify(indexShape(index))
const shortId = index => createHash('sha256').update(signature(index)).digest('hex').slice(0, 12)
function validateManifest(manifest) {
  if (!Array.isArray(manifest?.indexes) || !manifest.indexes.length || manifest.indexes.length > 1000) throw fail('Manifest must contain between 1 and 1000 composite indexes')
  const seen = new Set()
  return manifest.indexes.map(index => {
    if (index.collectionGroup !== 'records' || index.queryScope !== 'COLLECTION' || (index.apiScope && index.apiScope !== 'ANY_API')) throw fail('Manifest must target standard records collection indexes only')
    if (!Array.isArray(index.fields) || index.fields.length < 2 || index.fields.length > 100) throw fail('Invalid composite index field count')
    if (new Set(index.fields.map(field => field.fieldPath)).size !== index.fields.length || index.fields.filter(field => field.arrayConfig).length > 1) throw fail('Duplicate or multiple array index fields')
    for (const field of index.fields) {
      if (typeof field.fieldPath !== 'string' || !/^(data\.[A-Za-z_][A-Za-z0-9_.]*|__name__)$/.test(field.fieldPath) || Boolean(field.order) === Boolean(field.arrayConfig) || field.vectorConfig || (field.order && !['ASCENDING', 'DESCENDING'].includes(field.order)) || (field.arrayConfig && field.arrayConfig !== 'CONTAINS')) throw fail('Unsupported index field definition')
    }
    if (index.fields.at(-1).fieldPath !== '__name__' || index.fields.at(-1).order !== 'ASCENDING') throw fail('Manifest must preserve explicit ascending document-ID ordering')
    const key = signature(index)
    if (seen.has(key)) throw fail('Duplicate manifest index')
    seen.add(key)
    return { queryScope: index.queryScope, fields: indexShape(index).fields }
  })
}
function planIndexes(desired, existing) {
  const byShape = new Map(existing.map(index => [signature(index), index]))
  const missing = desired.filter(index => !byShape.has(signature(index)))
  const states = { ready: 0, creating: 0, needsRepair: 0, unknown: 0 }
  for (const index of desired) {
    const current = byShape.get(signature(index))
    if (!current) continue
    if (current.state === 'READY') states.ready++
    else if (current.state === 'CREATING') states.creating++
    else if (current.state === 'NEEDS_REPAIR') states.needsRepair++
    else states.unknown++
  }
  return { missing, summary: { target: PARENT, desired: desired.length, existing: existing.length, missing: missing.length, ...states, complete: states.ready === desired.length } }
}
async function requestWithRetry(request, options, { sleep = delay, attempts = 5 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await request({ ...options, timeout: 30000, retry: false }) } catch (error) {
      error.phase = options.url === IAM_URL ? 'iam-preflight' : options.method === 'POST' ? 'index-create' : 'index-list'
      if (![429, 503].includes(statusOf(error)) || attempt >= attempts - 1) throw error
      await sleep(Math.min(16000, 1000 * 2 ** attempt))
    }
  }
}
async function listIndexes(request, retryOptions) {
  const indexes = [], seenTokens = new Set()
  let pageToken
  do {
    // This project's admin endpoint accepts only the default page size (0).
    // Continue following page tokens without imposing an unsupported size.
    const result = await requestWithRetry(request, { method: 'GET', url: INDEX_URL, ...(pageToken ? { params: { pageToken } } : {}) }, retryOptions)
    if (result.data.indexes && !Array.isArray(result.data.indexes)) throw fail('Invalid index-list response')
    indexes.push(...(result.data.indexes || []))
    pageToken = result.data.nextPageToken
    if (pageToken && seenTokens.has(pageToken)) throw fail('Index-list pagination repeated a token')
    if (pageToken) seenTokens.add(pageToken)
  } while (pageToken)
  return indexes
}
async function run({ request, manifest, apply = false, concurrency = 2, report = () => {}, retryOptions } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw fail('Concurrency must be between 1 and 4')
  const desired = validateManifest(manifest)
  const iam = await requestWithRetry(request, { method: 'POST', url: IAM_URL, data: { permissions: PERMISSIONS } }, retryOptions)
  const permissions = new Set(iam.data.permissions || [])
  if (!permissions.has('datastore.indexes.list')) throw fail('Missing datastore.indexes.list permission; no indexes changed', 403)
  const existing = await listIndexes(request, retryOptions), plan = planIndexes(desired, existing)
  report({ phase: 'plan', mode: apply ? 'apply' : 'read-only', canCreate: permissions.has('datastore.indexes.create'), ...plan.summary })
  if (!apply || !plan.missing.length) return plan.summary
  // Test every required permission before the first create. A partial/denied
  // preflight never triggers index writes or falls back to another identity.
  if (!permissions.has('datastore.indexes.create')) throw fail('Missing datastore.indexes.create permission; no indexes changed', 403)
  let cursor = 0, accepted = 0, conflict = 0, stopped = false
  const errors = []
  const workers = Array.from({ length: Math.min(concurrency, plan.missing.length) }, async () => {
    while (!stopped && cursor < plan.missing.length) {
      const index = plan.missing[cursor++]
      try {
        const result = await requestWithRetry(request, { method: 'POST', url: INDEX_URL, data: index }, retryOptions)
        if (result.data?.error) throw fail('Index creation operation failed', result.data.error.code)
        accepted++
        report({ phase: 'create-accepted', index: shortId(index), accepted, total: plan.missing.length })
      } catch (error) {
        // A lost create response or another operator may race this plan. Only
        // the final exact-shape listing proves that a conflicting index exists.
        if (statusOf(error) === 409) { conflict++; continue }
        stopped = true
        errors.push({ index: shortId(index), ...providerFailure(error) })
      }
    }
  })
  await Promise.all(workers)
  const final = planIndexes(desired, await listIndexes(request, retryOptions)).summary
  const summary = { ...final, accepted, conflicts: conflict, failures: errors }
  report({ phase: 'status', ...summary })
  if (errors.length) throw fail('Index submission stopped after an error; prior accepted indexes are preserved. Rerun dry-run to reconcile', errors[0].status)
  return summary
}
function parseArgs(args) {
  const result = { apply: false, check: false, concurrency: 2 }
  for (const arg of args) {
    if (arg === '--apply') result.apply = true
    else if (arg === '--check') result.check = true
    else if (/^--concurrency=[1-4]$/.test(arg)) result.concurrency = Number(arg.split('=')[1])
    else throw fail('Usage: node scripts/firestore-migration/deploy-indexes.cjs [--apply | --check] [--concurrency=1..4]')
  }
  if (result.apply && result.check) throw fail('--apply and --check are mutually exclusive')
  return result
}
async function main() {
  const options = parseArgs(process.argv.slice(2))
  const env = require('dotenv').parse(fs.readFileSync(path.join(ROOT, '.env')))
  let credentials
  try { credentials = JSON.parse(env.FIRESTORE_SERVICE_ACCOUNT_JSON || env.FIREBASE_SERVICE_ACCOUNT_KEY) } catch { throw fail('A valid service-account JSON credential is required in repository .env') }
  // The approved service account belongs to a different Firebase project; its
  // target-project IAM grant, not its owning project, controls index access.
  if (credentials.type !== 'service_account' || credentials.client_email !== APPROVED_PRINCIPAL || !credentials.private_key) throw fail('Repository credential is not the approved migration service account')
  const { google } = require('googleapis')
  const client = await new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient()
  const summary = await run({ ...options, request: request => client.request(request), manifest: JSON.parse(fs.readFileSync(path.join(ROOT, 'firestore.indexes.json'), 'utf8')), report: value => console.log(JSON.stringify(value)) })
  if (options.check && !summary.complete) process.exitCode = 2
}
module.exports = { PROJECT, PARENT, INDEX_URL, IAM_URL, validateManifest, planIndexes, requestWithRetry, listIndexes, run, parseArgs, providerFailure }
if (require.main === module) main().catch(error => {
  // Never dump provider errors: they can contain Authorization headers, request
  // configuration, credentials or opaque response payloads.
  console.error(JSON.stringify({ error: error.safeMessage || 'Index admin request failed; inspect IAM/network configuration', ...providerFailure(error), ...(error.phase ? { phase: error.phase } : {}) }))
  process.exitCode = 1
})
