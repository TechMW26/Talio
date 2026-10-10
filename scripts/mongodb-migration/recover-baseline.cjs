#!/usr/bin/env node
'use strict'

// Local artifacts only. Never connects to a provider, rewrites the failed run,
// invents a missing traversal queue, or claims point-in-time/source completeness.
const fs = require('node:fs/promises')
const path = require('node:path')
const { loadIndexedEntries } = require('./migrate.cjs')
const { sha256 } = require('./core.cjs')
const validRun = run => typeof run === 'string' && /^[a-z][a-z0-9-]{7,79}$/.test(run)

async function recoverBaseline(root, previousRun, run) {
  if (!validRun(previousRun) || !validRun(run) || previousRun === run) throw new Error('DISTINCT_EXPLICIT_RECOVERY_RUNS_REQUIRED')
  const previousDir = path.join(root, '.migration-data', previousRun), dir = path.join(root, '.migration-data', run)
  const originalBytes = await fs.readFile(path.join(previousDir, 'manifest.json'))
  const previous = JSON.parse(originalBytes)
  if (previous.run !== previousRun || previous.complete !== false || !Array.isArray(previous.collections)) throw new Error('INCOMPLETE_RETAINED_BASELINE_REQUIRED')
  await fs.mkdir(dir, { mode: 0o700 }) // Existing recovery run is never overwritten.
  for (const collection of previous.collections) {
    const entries = await loadIndexedEntries(previousDir, { collections: [collection] })
    try { entries.assertUnchanged() } finally { entries.close() }
    // Linking changes ctime. All validation handles/fingerprints must be closed
    // before establishing the preservation link, including on validation error.
    await fs.link(path.join(previousDir, collection.file), path.join(dir, collection.file))
  }
  if (sha256(await fs.readFile(path.join(previousDir, 'manifest.json'))) !== sha256(originalBytes)) throw new Error('PREVIOUS_BASELINE_CHANGED_DURING_RECOVERY')
  const manifest = { ...previous, run, recoveryGeneration: true, sourceRecoveryRun: previousRun, sourceRecoveryManifestHash: sha256(originalBytes), previousArchivesRetained: true, consistency: 'explicit-recovery-generation-per-document-reads-requires-frozen-final-reconciliation', currentSourceVerified: false, complete: false, startedAt: new Date().toISOString() }
  delete manifest.exportFinishedAt
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 })
  return { run, previousRun, linkedCompletedCollections: previous.collections.length, previousArchivesRetained: true, complete: false, sourceWritesPerformed: false }
}

if (require.main === module) {
  process.umask(0o077)
  const [previousRun, run, ...extra] = process.argv.slice(2)
  if (extra.length) { console.error('Usage: recover-baseline.cjs <failedRun> <newRecoveryRun>'); process.exitCode = 1 }
  else recoverBaseline(path.resolve(__dirname, '../..'), previousRun, run).then(report => console.log(JSON.stringify({ event: 'baseline-recovery-initialized', ...report }))).catch(error => { console.error(JSON.stringify({ event: 'baseline-recovery-failed', code: error.code || null, message: error.code ? 'LOCAL_RECOVERY_ARTIFACT_ERROR' : error.message })); process.exitCode = 1 })
}
module.exports = { recoverBaseline }
