'use strict'

// Independent source reads only. Never changes source/target/provider state.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { canonical, sha256, snapshotEntry, protoValue } = require('./core.cjs')
const { pack } = require('../../lib/platform/firestoreCodec.cjs')
const { loadIndexedEntries } = require('./indexed-archive.cjs')
const { timestamp, compareTimestamp, readMetadataPage, ancestorPrefixes } = require('./fixed-epoch-metadata.cjs')
const EXPORT_PROTOCOL = 'fixed-epoch-metadata-exact-version-body-reuse-v1'
const PROTOCOL = 'fixed-epoch-metadata-and-version-bound-body-verification-v1'
const hashValid = value => /^[a-f0-9]{64}$/.test(value || '')
const time = value => typeof value === 'string' ? Date.parse(value) : NaN
const equalTime = (a, b) => { try { return compareTimestamp(a, b) === 0 } catch { return false } }
function epochMilliseconds(value) { const exact = timestamp(value); return Number(exact.seconds) * 1000 + Math.floor(exact.nanos / 1000000) }

function validateFixedEpochVerification(source, expected, now = Date.now()) {
  const candidate = expected.fixedEpochCandidate
  const fail = () => { throw new Error('BOUND_FIXED_EPOCH_SOURCE_VERIFICATION_REQUIRED') }
  if (!candidate || candidate.consistency !== EXPORT_PROTOCOL || candidate.finalSnapshot !== true || candidate.sourceVerificationRequired !== true || candidate.complete !== true || candidate.cutoverSafe !== false || candidate.applicationCutover !== false || candidate.sourceWrites !== 0 || candidate.targetWrites !== 0 || !hashValid(candidate.baselineManifestHash) || !hashValid(candidate.sourceBaselineManifestHash) || !hashValid(candidate.writerDrainEvidenceHash) || !/^[a-z][a-z0-9-]{7,79}$/.test(candidate.baselineRun || '') || !/^[a-z][a-z0-9-]{7,79}$/.test(candidate.sourceBaselineRun || '')) fail()
  let epoch
  try { epoch = epochMilliseconds(candidate.readTime) } catch { fail() }
  const drained = time(candidate.writersDrainedAt), exported = time(expected.candidateExportFinishedAt), started = time(source?.verificationStartedAt), finished = time(source?.verifiedAt)
  if (!Number.isFinite(drained) || drained > epoch || epoch > time(candidate.startedAt) || !Number.isFinite(exported) || exported < time(candidate.startedAt) || !Number.isFinite(started) || started < exported || !Number.isFinite(finished) || finished < started || finished > now) fail()
  if (!source || source.verificationProtocol !== PROTOCOL || source.complete !== true || source.unchangedAtRead !== true || source.archiveUnchanged !== true || source.fullTopologyVerified !== true || source.metadataUpdateTimesVerified !== true || source.sameEpochMetadataReread !== true || source.changedBodiesIndependentlyRead !== true || source.reusedBodiesIndependentlyAudited !== true || source.sourceWrites !== 0 || source.targetWrites !== 0 || source.cutoverSafe !== false || !equalTime(source.readTime, candidate.readTime) || source.writerDrainEvidenceHash !== candidate.writerDrainEvidenceHash || source.writersDrainedAt !== candidate.writersDrainedAt || source.baselineRun !== candidate.baselineRun || source.baselineManifestHash !== candidate.baselineManifestHash || source.sourceBaselineRun !== candidate.sourceBaselineRun || source.sourceBaselineManifestHash !== candidate.sourceBaselineManifestHash) fail()
  if (source.run !== expected.run || source.candidateManifestHash !== expected.candidateManifestHash || source.sourceHash !== expected.sourceHash || source.sourceHashVersion !== 'canonical-sorted-collections-v1' || source.sourceProject !== expected.sourceProject || source.sourceDatabase !== expected.sourceDatabase || !Array.isArray(source.datasets) || !Array.isArray(expected.datasets) || !Array.isArray(candidate.datasets) || canonical([...source.datasets].sort()) !== canonical([...expected.datasets].sort()) || canonical([...candidate.datasets].sort()) !== canonical([...expected.datasets].sort())) fail()
  const evidence = candidate.metadataEvidence
  if (!evidence || evidence.terminalPageObserved !== true || evidence.globallyOrdered !== true || !hashValid(evidence.metadataHash) || !equalTime(evidence.readTime, candidate.readTime) || source.metadataHash !== evidence.metadataHash || source.terminalPageObserved !== true || !Number.isSafeInteger(source.metadataPages) || source.metadataPages < 1) fail()
  for (const field of ['reusedDocuments', 'fullDocumentsFetched', 'metadataDocuments', 'missingParents']) if (!Number.isSafeInteger(source[field]) || source[field] < 0 || source[field] !== candidate[field]) fail()
  if (source.reusedDocuments + source.fullDocumentsFetched !== source.metadataDocuments || source.fullBodiesRead !== (source.reusedDocuments === 0) || source.noReuse !== (source.reusedDocuments === 0) || candidate.fullBodiesRead !== source.fullBodiesRead || candidate.noReuse !== source.noReuse || source.reusedBodiesVerified !== source.reusedDocuments || source.changedBodiesVerified !== source.fullDocumentsFetched || !expected.sourceCounts || ['collectionsVerified', 'documentsVerified', 'missingParentsVerified'].some(field => source[field] !== expected.sourceCounts[field]) || source.documentsVerified !== source.metadataDocuments || source.missingParentsVerified !== source.missingParents) fail()
  return { mode: PROTOCOL, startedAt: new Date(epoch).toISOString(), readTime: timestamp(candidate.readTime), verifiedAt: source.verifiedAt, writerDrainEvidenceHash: candidate.writerDrainEvidenceHash }
}

async function verifyFixedEpochCandidate(options) {
  // Lazy imports avoid the shared migration-validator/exporter import cycle.
  const { reusable, readBodies, readManifest, checkDirectory } = require('./fixed-epoch-export.cjs')
  const { sourceCollectionsHash, sourceTreeCounts } = require('./migrate.cjs')
  const directory = checkDirectory(options.directory), baselineDirectory = checkDirectory(options.baselineDirectory)
  const manifest = readManifest(directory, options.candidateManifestHash)
  const baseline = readManifest(baselineDirectory, manifest.baselineManifestHash)
  if (manifest.consistency !== EXPORT_PROTOCOL || manifest.finalSnapshot !== true || manifest.sourceVerificationRequired !== true || baseline.run !== manifest.baselineRun || baseline.sourceProject !== manifest.sourceProject || baseline.sourceDatabase !== manifest.sourceDatabase || directory === baselineDirectory || typeof options.snapshotFromDocument !== 'function') throw new Error('EXPLICIT_FINAL_FIXED_EPOCH_ARCHIVES_REQUIRED')
  const now = options.now ?? Date.now, batchSize = options.batchSize ?? 64
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error('BOUNDED_VERIFICATION_BATCH_REQUIRED')
  const entries = await loadIndexedEntries(directory, manifest)
  let donor
  try {
    donor = await loadIndexedEntries(baselineDirectory, baseline)
    const verificationStartedAt = new Date(now()).toISOString(), metadataHash = createHash('sha256'), seen = new Set(), parents = new Set()
    const scope = { sourceProject: manifest.sourceProject, sourceDatabase: manifest.sourceDatabase, readTime: manifest.readTime, limit: options.pageSize ?? 1000, deadlineMs: options.deadlineMs, signal: options.signal, now }
    let afterName, metadataPages = 0, reusedDocuments = 0, fullDocumentsFetched = 0
    for (;;) {
      const page = await readMetadataPage(options.client, { ...scope, ...(afterName ? { afterName } : {}) }); metadataPages++
      for (let offset = 0; offset < page.rows.length; offset += batchSize) {
        const changed = []
        for (const row of page.rows.slice(offset, offset + batchSize)) {
          if (seen.has(row.path)) throw new Error('DUPLICATE_FIXED_EPOCH_METADATA')
          seen.add(row.path); metadataHash.update(canonical(row) + '\n')
          for (const parent of ancestorPrefixes(row.name, scope).possibleMissingParents) parents.add(parent)
          const entry = entries.get(row.path), previous = donor.get(row.path)
          if (!entry?.exists || !equalTime(entry.updateTime, row.updateTime) || (entry.createTime && !equalTime(entry.createTime, row.createTime))) throw new Error('FIXED_EPOCH_ARCHIVE_VERSION_MISMATCH')
          if (reusable(previous, row)) {
            if (canonical(previous) !== canonical(entry)) throw new Error('FIXED_EPOCH_REUSED_BODY_CHANGED')
            reusedDocuments++
          } else changed.push(row)
        }
        const bodies = await readBodies(options.client, changed, scope)
        for (let index = 0; index < bodies.length; index++) {
          const raw = bodies[index], row = changed[index], decoded = snapshotEntry(options.snapshotFromDocument(raw, manifest.readTime))
          if (decoded.path !== row.path || !decoded.exists || !equalTime(decoded.updateTime, row.updateTime) || canonical(decoded.fields) !== canonical(pack(protoValue(raw.fields || {})))) throw new Error('FIXED_EPOCH_BODY_DECODE_MISMATCH')
          const expected = { ...decoded, createTime: { seconds: row.createTime.seconds, nanoseconds: row.createTime.nanos } }
          if (canonical(entries.get(row.path)) !== canonical(expected)) throw new Error('FIXED_EPOCH_FRESH_BODY_CHANGED')
          fullDocumentsFetched++
        }
      }
      options.onProgress?.({ metadataPages, documentsVerified: seen.size, reusedDocuments, fullDocumentsFetched })
      if (page.done) break
      afterName = page.afterName
    }
    let missingParents = 0
    for (const parent of parents) if (!seen.has(parent)) {
      if (canonical(entries.get(parent)) !== canonical(snapshotEntry({ exists: false, ref: { path: parent } }))) throw new Error('FIXED_EPOCH_MISSING_PARENT_CHANGED')
      missingParents++
    }
    if (entries.size !== seen.size + missingParents) throw new Error('FIXED_EPOCH_UNEXPECTED_ARCHIVE_ENTRY')
    entries.assertUnchanged(); donor.assertUnchanged()
    readManifest(directory, options.candidateManifestHash); readManifest(baselineDirectory, manifest.baselineManifestHash)
    const report = {
      run: manifest.run, candidateManifestHash: options.candidateManifestHash, verificationProtocol: PROTOCOL,
      sourceProject: manifest.sourceProject, sourceDatabase: manifest.sourceDatabase, datasets: manifest.datasets,
      baselineRun: manifest.baselineRun, baselineManifestHash: manifest.baselineManifestHash,
      sourceBaselineRun: manifest.sourceBaselineRun, sourceBaselineManifestHash: manifest.sourceBaselineManifestHash,
      readTime: manifest.readTime, writersDrainedAt: manifest.writersDrainedAt, writerDrainEvidenceHash: manifest.writerDrainEvidenceHash,
      sourceHash: sourceCollectionsHash(manifest.collections), sourceHashVersion: 'canonical-sorted-collections-v1',
      verificationStartedAt, verifiedAt: new Date(now()).toISOString(),
      reusedDocuments, fullDocumentsFetched, metadataDocuments: seen.size, missingParents,
      reusedBodiesVerified: reusedDocuments, changedBodiesVerified: fullDocumentsFetched,
      fullBodiesRead: reusedDocuments === 0, noReuse: reusedDocuments === 0,
      metadataHash: metadataHash.digest('hex'), metadataPages, terminalPageObserved: true,
      sameEpochMetadataReread: true, changedBodiesIndependentlyRead: true, reusedBodiesIndependentlyAudited: true,
      fullTopologyVerified: true, metadataUpdateTimesVerified: true, archiveUnchanged: true, unchangedAtRead: true,
      ...sourceTreeCounts(manifest.collections), complete: true, sourceWrites: 0, targetWrites: 0, cutoverSafe: false,
    }
    validateFixedEpochVerification(report, { ...report, candidateStartedAt: manifest.startedAt, candidateExportFinishedAt: manifest.exportFinishedAt, sourceCounts: sourceTreeCounts(manifest.collections), fixedEpochCandidate: manifest }, now())
    const output = path.join(directory, 'source-verification.json')
    fs.writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' })
    return report
  } finally { entries.close(); donor?.close() }
}

module.exports = { PROTOCOL, EXPORT_PROTOCOL, epochMilliseconds, validateFixedEpochVerification, verifyFixedEpochCandidate }
