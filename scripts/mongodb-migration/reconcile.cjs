#!/usr/bin/env node
'use strict'

// Source reads and protected local writes ONLY. Never connects to MongoDB,
// changes application configuration, deletes source data or claims cutover.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const dotenv = require('dotenv')
const { loadIndexedEntries, exportTree } = require('./migrate.cjs')
const { sha256, canonical, mongoRecordId, materializeRecord, materializeClaim, materializeCatalog } = require('./core.cjs')

const validRun = run => typeof run === 'string' && /^[a-z][a-z0-9-]{7,79}$/.test(run)
const entryHash = entry => entry ? sha256(canonical(entry)) : null

function compareEntries(before, after) {
  const changes = [], totals = { added: 0, updated: 0, removed: 0, metadataOnly: 0, unchanged: 0 }
  for (const documentPath of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(documentPath), current = after.get(documentPath)
    if (entryHash(old) === entryHash(current)) { totals.unchanged++; continue }
    const action = !old ? 'added' : !current ? 'removed' : 'updated'
    totals[action]++
    const metadataOnly = Boolean(old && current && old.exists === current.exists && old.sha256 === current.sha256)
    if (metadataOnly) totals.metadataOnly++
    // Journal contains identity/checksums only. Bodies remain in the two complete
    // immutable archives, including removed documents and previous parts.
    changes.push({ path: documentPath, action, metadataOnly, beforeHash: entryHash(old), afterHash: entryHash(current), beforeValueHash: old?.sha256 || null, afterValueHash: current?.sha256 || null })
  }
  return { totals, changes }
}

function targetDocuments(entries, datasets) {
  // Index only identities. Holding both materialized trees retains multiple GB
  // of envelopes/overflow payloads; resolve one document at a time instead.
  const identities = new Map(), selected = new Set(datasets)
  for (const entry of entries.values()) {
    if (!entry.exists) continue
    let match = /^talioDatasets\/([^/]+)\/databases\/([^/]+)\/collections\/([^/]+)\/records\/([^/]+)$/.exec(entry.path)
    if (match && selected.has(match[1])) {
      const id = mongoRecordId(...match.slice(1))
      identities.set(`talio_records/${id}`, { bank: 'talio_records', path: entry.path, dataset: match[1] })
      continue
    }
    match = /^talioDatasets\/([^/]+)\/databases\/([^/]+)\/uniqueKeys\/([^/]+)$/.exec(entry.path)
    if (match && selected.has(match[1])) {
      const id = sha256(JSON.stringify(match.slice(1)))
      identities.set(`talio_unique_keys/${id}`, { bank: 'talio_unique_keys', path: entry.path, dataset: match[1] })
      continue
    }
    match = /^talioDatasets\/([^/]+)$/.exec(entry.path)
    if (match) identities.set(`talio_catalogs/${match[1]}`, { bank: 'talio_catalogs', path: entry.path })
  }
  const documents = {
    get size() { return identities.size },
    has(key) { return identities.has(key) },
    keys() { return identities.keys() },
    get(key) {
      const identity = identities.get(key)
      if (!identity) return undefined
      const entry = entries.get(identity.path)
      const document = identity.bank === 'talio_records' ? materializeRecord(entry, entries, identity.dataset)
        : identity.bank === 'talio_unique_keys' ? materializeClaim(entry, identity.dataset) : materializeCatalog(entry)
      if (!document || `${identity.bank}/${document._id}` !== key) throw new Error('TARGET_DOCUMENT_IDENTITY_MISMATCH')
      return { bank: identity.bank, document }
    },
    *values() { for (const key of identities.keys()) yield documents.get(key) },
    *entries() { for (const key of identities.keys()) yield [key, documents.get(key)] },
    [Symbol.iterator]() { return documents.entries() },
  }
  return documents
}

function targetDeltaPlan(before, after, datasets) {
  const oldDocuments = targetDocuments(before, datasets), currentDocuments = targetDocuments(after, datasets)
  const operations = [], totals = { insert: 0, replace: 0, removeFromLiveBank: 0, unchanged: 0 }
  for (const key of [...new Set([...oldDocuments.keys(), ...currentDocuments.keys()])].sort()) {
    const old = oldDocuments.get(key), current = currentDocuments.get(key)
    const beforeHash = old ? sha256(canonical(old.document)) : null
    const afterHash = current ? sha256(canonical(current.document)) : null
    if (beforeHash === afterHash) { totals.unchanged++; continue }
    const action = !old ? 'insert' : !current ? 'removeFromLiveBank' : 'replace'
    totals[action]++
    operations.push({ bank: (current || old).bank, id: (current || old).document._id, action, beforeHash, afterHash })
  }
  return { version: 1, datasets, totals, operations, targetWritesPerformed: false, requiresOptimisticBeforeHashCheck: true, requiresFrozenSourceAndNoTargetWriters: true }
}

async function writeProtectedJson(file, value) {
  const temporary = `${file}.tmp`
  try { await fsp.access(temporary); await fsp.rename(temporary, `${temporary}.preserved-${Date.now()}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
  await fsp.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  await fsp.rename(temporary, file)
}

async function reconcileArchive({ db, root, baselineRun, candidateRun, datasets, childConcurrency = 16 }) {
  if (!validRun(baselineRun) || !validRun(candidateRun) || baselineRun === candidateRun) throw new Error('DISTINCT_EXPLICIT_MIGRATION_RUNS_REQUIRED')
  if (!Array.isArray(datasets) || !datasets.length || datasets.some(dataset => !/^[a-z][a-z0-9-]{7,79}$/.test(dataset))) throw new Error('EXPLICIT_DATASET_ALLOWLIST_REQUIRED')
  const baselineDir = path.join(root, '.migration-data', baselineRun), candidateDir = path.join(root, '.migration-data', candidateRun)
  const baselineBytes = await fsp.readFile(path.join(baselineDir, 'manifest.json'))
  const baseline = JSON.parse(baselineBytes)
  if (!baseline.complete || baseline.run !== baselineRun) throw new Error('COMPLETE_BASELINE_REQUIRED')
  const baselineHash = sha256(baselineBytes)
  // Validate the complete baseline before issuing source reads. Corrupted input
  // cannot turn into a plausible-looking delta report.
  const before = await loadIndexedEntries(baselineDir, baseline)
  let after
  try {
    await fsp.mkdir(candidateDir, { recursive: true, mode: 0o700 })
    const candidateFile = path.join(candidateDir, 'manifest.json')
    const candidateExists = fs.existsSync(candidateFile)
    const candidate = candidateExists ? JSON.parse(await fsp.readFile(candidateFile)) : {
      version: 1, run: candidateRun, sourceProject: baseline.sourceProject, sourceDatabase: baseline.sourceDatabase,
      selectedDataset: baseline.selectedDataset, sourceBaselineRun: baselineRun, sourceBaselineManifestHash: baselineHash,
      datasets: [...new Set(datasets)].sort(), consistency: 'final-per-document-reconciliation-requires-frozen-writers',
      complete: false, cutoverSafe: false, sourceVerificationRequired: true, collections: [], startedAt: new Date().toISOString(),
    }
    if (candidate.complete) throw new Error('COMPLETED_CANDIDATE_IS_IMMUTABLE_USE_NEW_RUN')
    if (candidate.run !== candidateRun || candidate.sourceBaselineRun !== baselineRun || candidate.sourceBaselineManifestHash !== baselineHash || canonical(candidate.datasets) !== canonical([...new Set(datasets)].sort())) throw new Error('RECONCILIATION_BASELINE_CONFLICT')
    if (!candidateExists) await writeProtectedJson(candidateFile, candidate)
    const collections = await exportTree(db, candidateDir, candidate, false, { childConcurrency })
    candidate.collections = collections
    after = await loadIndexedEntries(candidateDir, candidate)
    const delta = compareEntries(before, after)
    const targetPlan = targetDeltaPlan(before, after, candidate.datasets)
    before.assertUnchanged(); after.assertUnchanged()
    const report = {
      version: 1, baselineRun, candidateRun, baselineManifestHash: baselineHash,
      candidateCollectionHash: sha256(canonical(collections)), totals: delta.totals,
      completeCurrentStateScan: true, stableSourceVerified: false, cutoverSafe: false,
      writerFreezeRequiredForCutover: true, historicalTransientMutationsRecoverable: false,
      targetWritesPerformed: false, finishedAt: new Date().toISOString(),
    }
    await writeProtectedJson(path.join(candidateDir, 'source-delta.json'), { ...report, changes: delta.changes })
    await writeProtectedJson(path.join(candidateDir, 'target-delta-plan.json'), targetPlan)
    await writeProtectedJson(path.join(candidateDir, 'reconciliation-report.json'), report)
    // Completion means all current documents were archived and both local trees
    // checked. It does NOT stand in for a subsequent frozen-source verification.
    candidate.complete = true; candidate.exportFinishedAt = report.finishedAt
    await writeProtectedJson(candidateFile, candidate)
    // Prove the baseline was not rewritten by any reconciliation step.
    if (sha256(await fsp.readFile(path.join(baselineDir, 'manifest.json'))) !== baselineHash) throw new Error('BASELINE_CHANGED_DURING_RECONCILIATION')
    console.log(JSON.stringify({ event: 'source-reconciliation-complete', totals: report.totals, targetTotals: targetPlan.totals, cutoverSafe: false, targetWritesPerformed: false }))
    return report
  } finally { before.close(); after?.close() }
}

async function main() {
  process.umask(0o077)
  const [baselineRun, candidateRun, datasetFlag] = process.argv.slice(2)
  if (!validRun(baselineRun) || !validRun(candidateRun) || !/^--datasets=[a-z0-9,-]+$/.test(datasetFlag || '')) throw new Error('Usage: reconcile.cjs <baselineRun> <newCandidateRun> --datasets=<local>,<live>')
  const root = path.resolve(__dirname, '../..')
  const readEnv = file => fs.existsSync(path.join(root, file)) ? dotenv.parse(fs.readFileSync(path.join(root, file))) : {}
  const env = { ...readEnv('.env'), ...readEnv('.env.local'), ...process.env }
  const baseline = JSON.parse(await fsp.readFile(path.join(root, '.migration-data', baselineRun, 'manifest.json')))
  if (process.env.FIRESTORE_EMULATOR_HOST || !env.FIRESTORE_SERVICE_ACCOUNT_JSON || (env.FIRESTORE_PROJECT_ID && env.FIRESTORE_PROJECT_ID !== baseline.sourceProject)) throw new Error('EXPLICIT_MATCHING_CLOUD_SOURCE_REQUIRED')
  let credential
  try { credential = JSON.parse(env.FIRESTORE_SERVICE_ACCOUNT_JSON) } catch { throw new Error('SOURCE_CREDENTIAL_INVALID') }
  const admin = require('firebase-admin')
  const app = admin.initializeApp({ projectId: baseline.sourceProject, credential: admin.credential.cert(credential) }, `mongo-reconcile-${Date.now()}`)
  const db = require('firebase-admin/firestore').getFirestore(app, baseline.sourceDatabase || '(default)')
  try { await reconcileArchive({ db, root, baselineRun, candidateRun, datasets: datasetFlag.slice('--datasets='.length).split(','), childConcurrency: Number(env.MONGODB_EXPORT_CHILD_CONCURRENCY || 16) }) }
  finally { await db.terminate(); await app.delete() }
}

if (require.main === module) main().catch(error => { console.error(JSON.stringify({ event: 'reconciliation-failed', code: error.code || null, message: String(error.message).replace(/(?:mongodb(?:\+srv)?|https?):\/\/\S+/g, '[REDACTED_URI]') })); process.exitCode = 1 })
module.exports = { compareEntries, targetDocuments, targetDeltaPlan, reconcileArchive }
