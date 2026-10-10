#!/usr/bin/env node
'use strict'

// Offline descriptor comparisons only. No provider SDK, credentials, Blob IO,
// writes to source data, or implied proof that a donor's bytes are available.
const fs = require('node:fs')
const path = require('node:path')
const { sha256 } = require('./core.cjs')
const { loadIndexedEntries, sourceCollectionsHash } = require('./migrate.cjs')
const { collectMediaPlan } = require('./verify-media.cjs')
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const codes = new Set(['BLOB_OBJECT_UNAVAILABLE', 'BLOB_LENGTH_MISMATCH', 'BLOB_CHECKSUM_MISMATCH', 'MEDIA_VERIFICATION_BYTE_BUDGET_EXCEEDED', 'BLOB_READ_FAILED'])
const MAX_CANDIDATE_KEYS_PER_CATEGORY = 16
const sorted = values => [...new Set(values)].sort()
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

function candidateSummary(immutableKeys, mutableKeys, immutableCount = immutableKeys.length, mutableCount = mutableKeys.length) {
  const immutableCandidates = [...immutableKeys].sort().slice(0, MAX_CANDIDATE_KEYS_PER_CATEGORY)
  const mutableCandidates = [...mutableKeys].sort().slice(0, MAX_CANDIDATE_KEYS_PER_CATEGORY)
  return { immutableCandidates, mutableCandidates, immutableCandidateCount: immutableCount, mutableCandidateCount: mutableCount, omittedImmutableCandidateKeys: immutableCount - immutableCandidates.length, omittedMutableCandidateKeys: mutableCount - mutableCandidates.length, completeCandidateKeyCoverage: immutableCount === immutableCandidates.length && mutableCount === mutableCandidates.length }
}

function createMediaRecoveryPlan(plan, reportBytes, { expectedReportHash, run, datasets, candidateManifestHash, sourceHash } = {}) {
  if (!Buffer.isBuffer(reportBytes) || reportBytes.length > 16 * 1024 * 1024 || !isHash(expectedReportHash) || sha256(reportBytes) !== expectedReportHash) throw new Error('EXACT_PRIOR_MEDIA_REPORT_HASH_REQUIRED')
  const prior = JSON.parse(reportBytes)
  if (!Array.isArray(datasets) || !datasets.length || datasets.some(value => !/^[a-z][a-z0-9-]{7,79}$/.test(value)) || !Array.isArray(prior.datasets) || !same(sorted(datasets), sorted(prior.datasets))) throw new Error('MEDIA_RECOVERY_DATASET_SCOPE_MISMATCH')
  if (prior.command !== 'verify' || prior.complete !== true || prior.run !== run || !isHash(candidateManifestHash) || !isHash(sourceHash) || prior.candidateManifestHash !== candidateManifestHash || prior.sourceHash !== sourceHash || prior.sourceHashVersion !== 'canonical-sorted-collections-v1') throw new Error('MEDIA_RECOVERY_SOURCE_BINDING_MISMATCH')
  if (!plan?.report?.descriptorPlanPassed || prior.descriptorPlanPassed !== true || plan.report.referenceHash !== prior.referenceHash || !isHash(prior.referenceHash)) throw new Error('MEDIA_RECOVERY_DESCRIPTOR_OR_REFERENCE_MISMATCH')
  if (!Array.isArray(plan.objects) || plan.objects.length !== prior.requiredObjects || prior.objectsRead !== plan.objects.length || !Number.isSafeInteger(prior.failedObjects) || prior.failedObjects < 0 || prior.failedObjects > plan.objects.length || !Number.isSafeInteger(prior.objectsAvailable) || prior.objectsAvailable + prior.failedObjects !== prior.objectsRead || !Array.isArray(prior.failures) || prior.failures.length > prior.failedObjects) throw new Error('INVALID_PRIOR_MEDIA_FAILURE_COUNTS')
  const failed = new Map()
  for (const failure of prior.failures) {
    if (!isHash(failure?.keyHash) || !codes.has(failure.code) || failed.has(failure.keyHash)) throw new Error('INVALID_PRIOR_MEDIA_FAILURE_IDENTITY')
    failed.set(failure.keyHash, failure.code)
  }
  const omitted = prior.failedObjects - failed.size
  if (prior.omittedFailureKeys !== undefined && prior.omittedFailureKeys !== omitted) throw new Error('PRIOR_MEDIA_FAILURE_TRUNCATION_MISMATCH')
  const objects = new Map(), signatures = new Map()
  const signature = object => isHash(object.sha256) && Number.isSafeInteger(object.length) && object.length >= 0 ? `${object.sha256}/${object.length}` : null
  for (const object of plan.objects) {
    if (!isHash(object.keyHash) || objects.has(object.keyHash)) throw new Error('INVALID_MEDIA_PLAN_OBJECT_IDENTITY')
    objects.set(object.keyHash, object)
    const key = signature(object)
    if (key) {
      if (!signatures.has(key)) signatures.set(key, { immutableKeys: [], mutableKeys: [], immutableCount: 0, mutableCount: 0 })
      // Filter once, not once per failed object. Keep only bounded, deterministic
      // representative hashes while counting every eligible donor exactly.
      if (!failed.has(object.keyHash)) {
        const group = signatures.get(key), category = object.immutable ? 'immutable' : 'mutable'
        group[`${category}Count`]++
        const keys = group[`${category}Keys`]
        keys.push(object.keyHash); keys.sort()
        if (keys.length > MAX_CANDIDATE_KEYS_PER_CATEGORY) keys.pop()
      }
    }
  }
  const rows = [...failed].sort(([left], [right]) => left.localeCompare(right)).map(([keyHash, code]) => {
    const object = objects.get(keyHash)
    if (!object) throw new Error('PRIOR_MEDIA_FAILURE_NOT_IN_SELECTED_SOURCE')
    const key = signature(object)
    // Known failed donors cannot help. A donor absent from a truncated report
    // may still be one of its omitted failures: all availability stays unknown.
    const candidates = key ? signatures.get(key) : null
    return {
      keyHash, code, category: object.immutable ? 'immutable-archive' : 'mutable-tenant',
      sourceSha256: isHash(object.sha256) ? object.sha256 : null,
      length: Number.isSafeInteger(object.length) && object.length >= 0 ? object.length : null,
      ...candidateSummary(candidates?.immutableKeys || [], candidates?.mutableKeys || [], candidates?.immutableCount || 0, candidates?.mutableCount || 0),
    }
  })
  const matched = rows.filter(row => row.immutableCandidates.length || row.mutableCandidates.length)
  return {
    command: 'offline-media-recovery-plan', schemaVersion: 1,
    priorReportHash: expectedReportHash, candidateManifestHash, sourceHash, referenceHash: prior.referenceHash,
    providerReads: 0, mediaWrites: 0, sourceWrites: 0,
    candidateAvailability: 'unverified-no-provider-reads', descriptorMatchesOnly: true,
    requiredObjects: plan.objects.length, totalFailedObjects: prior.failedObjects,
    recordedFailureKeys: failed.size, omittedFailureKeys: omitted, completeFailureKeyCoverage: omitted === 0,
    failuresWithCandidates: matched.length,
    failuresWithImmutableCandidates: rows.filter(row => row.immutableCandidates.length).length,
    failuresWithMutableCandidates: rows.filter(row => row.mutableCandidates.length).length,
    failuresWithoutCandidates: rows.length - matched.length,
    failuresWithoutSourceChecksumOrLength: rows.filter(row => !row.sourceSha256 || row.length === null).length,
    maximumCandidateKeysPerCategory: MAX_CANDIDATE_KEYS_PER_CATEGORY,
    completeCandidateKeyCoverage: rows.every(row => row.completeCandidateKeyCoverage),
    embeddedBinaryRecords: plan.report.embeddedBinaryRecords,
    rows,
  }
}

async function main() {
  const [run, ...args] = process.argv.slice(2)
  if (!/^[a-z][a-z0-9-]{7,79}$/.test(run || '')) throw new Error('EXPLICIT_OFFLINE_MEDIA_RUN_REQUIRED')
  const flags = {}
  for (const arg of args) {
    const match = /^--(datasets|report|report-sha256)=([^=]+)$/.exec(arg)
    if (!match || flags[match[1]] !== undefined) throw new Error('INVALID_OFFLINE_MEDIA_RECOVERY_FLAG')
    flags[match[1]] = match[2]
  }
  if (!flags.datasets || !isHash(flags['report-sha256']) || !/^[a-z0-9][a-z0-9.-]{0,119}\.json$/.test(flags.report || '') || flags.report.includes('..')) throw new Error('EXACT_OFFLINE_REPORT_AND_DATASETS_REQUIRED')
  const directory = path.resolve(__dirname, '../../.migration-data', run)
  const manifestBytes = fs.readFileSync(path.join(directory, 'manifest.json'))
  const manifest = JSON.parse(manifestBytes)
  if (manifest.complete !== true || manifest.run !== run) throw new Error('COMPLETE_SOURCE_EXPORT_REQUIRED')
  const reportPath = path.join(directory, flags.report)
  if (!fs.lstatSync(reportPath).isFile() || fs.statSync(reportPath).size > 16 * 1024 * 1024) throw new Error('BOUNDED_REGULAR_PRIOR_REPORT_REQUIRED')
  const reportBytes = fs.readFileSync(reportPath)
  if (sha256(reportBytes) !== flags['report-sha256']) throw new Error('EXACT_PRIOR_MEDIA_REPORT_HASH_REQUIRED')
  const entries = await loadIndexedEntries(directory, manifest)
  try {
    const datasets = flags.datasets.split(',')
    const plan = collectMediaPlan(entries, datasets)
    const result = createMediaRecoveryPlan(plan, reportBytes, { expectedReportHash: flags['report-sha256'], run, datasets, candidateManifestHash: sha256(manifestBytes), sourceHash: sourceCollectionsHash(manifest.collections) })
    entries.assertUnchanged()
    console.log(JSON.stringify(result, null, 2))
  } finally { entries.close() }
}
if (require.main === module) main().catch(() => { console.error(JSON.stringify({ event: 'offline-media-recovery-plan-failed', privateDetailsOmitted: true })); process.exitCode = 1 })
module.exports = { createMediaRecoveryPlan, candidateSummary }
