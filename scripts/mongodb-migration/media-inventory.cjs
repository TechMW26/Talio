#!/usr/bin/env node
'use strict'

// Read-only, metadata-only listing. This identifies absent required paths; it
// does NOT replace checksum/length byte acceptance or establish a write fence.
const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const { sha256 } = require('./core.cjs')
const { loadIndexedEntries, sourceCollectionsHash } = require('./migrate.cjs')
const { collectMediaPlan } = require('./verify-media.cjs')
const hashPattern = /^[a-f0-9]{64}$/

function inventoryPrefixes(objects) {
  const prefixes = new Set()
  for (const object of objects) {
    if (!object?.pathname || sha256(object.pathname) !== object.keyHash) throw new Error('EXACT_MEDIA_PATH_IDENTITY_REQUIRED')
    const match = /^(migrations\/talio-hrms\/[^/]+\/media\/|tenants\/[^/]+\/)/.exec(object.pathname)
    if (!match || object.pathname.includes('..') || /[\x00-\x1f\\?#]/.test(object.pathname)) throw new Error('SCOPED_MEDIA_PREFIX_REQUIRED')
    prefixes.add(match[1])
  }
  if (!prefixes.size || prefixes.size > 100) throw new Error('BOUNDED_MEDIA_PREFIXES_REQUIRED')
  return [...prefixes].sort()
}

async function inventoryMedia(plan, { listBlob, maxPages, anchors, onProgress } = {}) {
  if (!plan?.report?.descriptorPlanPassed || !Array.isArray(plan.objects) || plan.objects.length !== plan.report.requiredObjects || typeof listBlob !== 'function' || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 500) throw new Error('BOUNDED_EXACT_MEDIA_INVENTORY_REQUIRED')
  const objects = new Map(plan.objects.map(object => [object.keyHash, object]))
  if (objects.size !== plan.objects.length || !Array.isArray(anchors) || anchors.length < 1 || anchors.length > 16 || new Set(anchors.map(value => value.keyHash)).size !== anchors.length) throw new Error('VERIFIED_STORE_ALIGNMENT_ANCHORS_REQUIRED')
  for (const anchor of anchors) {
    const object = objects.get(anchor.keyHash)
    if (!hashPattern.test(anchor.keyHash || '') || anchor.verified !== true || anchor.httpStatus !== 200 || !object || object.sha256 !== anchor.actualSha256 || object.length !== anchor.bytesRead) throw new Error('VERIFIED_STORE_ALIGNMENT_ANCHORS_REQUIRED')
  }
  const prefixes = inventoryPrefixes(plan.objects), listed = new Map(), seen = new Set()
  let pages = 0, host = null
  const startedAt = new Date().toISOString()
  for (const prefix of prefixes) {
    let cursor
    const cursors = new Set()
    for (;;) {
      if (pages >= maxPages) throw new Error('MEDIA_INVENTORY_PAGE_BUDGET_EXCEEDED')
      const response = await listBlob({ prefix, limit: 1000, ...(cursor ? { cursor } : {}), abortSignal: AbortSignal.timeout(30000) })
      pages++
      if (!response || !Array.isArray(response.blobs) || response.blobs.length > 1000 || typeof response.hasMore !== 'boolean') throw new Error('INVALID_MEDIA_LIST_RESPONSE')
      for (const blob of response.blobs) {
        if (typeof blob.pathname !== 'string' || !blob.pathname.startsWith(prefix) || !Number.isSafeInteger(blob.size) || blob.size < 0) throw new Error('OUT_OF_SCOPE_MEDIA_LIST_RESPONSE')
        const keyHash = sha256(blob.pathname)
        if (seen.has(keyHash)) throw new Error('DUPLICATE_MEDIA_LIST_IDENTITY')
        seen.add(keyHash)
        const url = new URL(blob.url)
        if (url.protocol !== 'https:' || !url.hostname.endsWith('.private.blob.vercel-storage.com') || decodeURIComponent(url.pathname.slice(1)) !== blob.pathname || url.search || url.hash) throw new Error('PRIVATE_MEDIA_STORE_ALIGNMENT_REQUIRED')
        if (host && host !== url.hostname) throw new Error('PRIVATE_MEDIA_STORE_ALIGNMENT_REQUIRED')
        host = url.hostname
        if (objects.has(keyHash)) listed.set(keyHash, { keyHash, size: blob.size })
      }
      onProgress?.({ pagesRead: pages, objectsListed: seen.size, requiredObjectsFound: listed.size, prefixesComplete: prefixes.indexOf(prefix) + (response.hasMore ? 0 : 1), prefixesPlanned: prefixes.length })
      if (!response.hasMore) break
      if (typeof response.cursor !== 'string' || !response.cursor || cursors.has(response.cursor)) throw new Error('MEDIA_INVENTORY_CURSOR_DID_NOT_ADVANCE')
      cursors.add(response.cursor); cursor = response.cursor
    }
  }
  if (anchors.some(anchor => listed.get(anchor.keyHash)?.size !== anchor.bytesRead)) throw new Error('VERIFIED_STORE_ALIGNMENT_ANCHOR_MISSING')
  const failures = [], available = []
  for (const object of [...objects.values()].sort((a, b) => a.keyHash.localeCompare(b.keyHash))) {
    const found = listed.get(object.keyHash)
    if (!found) failures.push({ keyHash: object.keyHash, code: 'BLOB_OBJECT_UNAVAILABLE' })
    else if (object.length !== null && found.size !== object.length) failures.push({ keyHash: object.keyHash, code: 'BLOB_LENGTH_MISMATCH' })
    else available.push(found)
  }
  return { command: 'scoped-blob-media-inventory', schemaVersion: 1, complete: true, startedAt, verifiedAt: new Date().toISOString(), referenceHash: plan.report.referenceHash, requiredObjects: objects.size, objectsAvailable: available.length, failedObjects: failures.length, failures, omittedFailureKeys: 0, pagesRead: pages, objectsListed: seen.size, prefixesScanned: prefixes.length, storeAlignmentAnchorsVerified: anchors.length, storeHostHash: sha256(host), inventoryHash: sha256(JSON.stringify([...listed.values()].sort((a, b) => a.keyHash.localeCompare(b.keyHash)))), available, writes: 0, mediaBytesRead: 0, checksumVerificationPerformed: false, sourceWriteFenceEstablished: false }
}

async function main() {
  process.umask(0o077)
  const [run, ...args] = process.argv.slice(2), flags = {}
  if (!/^[a-z][a-z0-9-]{7,79}$/.test(run || '')) throw new Error('EXPLICIT_MEDIA_INVENTORY_RUN_REQUIRED')
  for (const arg of args) {
    const match = /^--(datasets|max-pages|anchors|anchors-sha256|output)=([^=]+)$/.exec(arg)
    if (!match || flags[match[1]] !== undefined) throw new Error('INVALID_MEDIA_INVENTORY_FLAG')
    flags[match[1]] = match[2]
  }
  const filename = value => /^[a-z0-9][a-z0-9.-]{0,119}\.json$/.test(value || '') && !value.includes('..')
  if (!flags.datasets || !filename(flags.anchors) || !filename(flags.output) || !hashPattern.test(flags['anchors-sha256'] || '')) throw new Error('EXACT_MEDIA_INVENTORY_EVIDENCE_REQUIRED')
  const root = path.resolve(__dirname, '../..'), directory = path.join(root, '.migration-data', run)
  const protectedRead = file => {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    try {
      const stat = fs.fstatSync(fd)
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024 || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) throw new Error('PROTECTED_MEDIA_INVENTORY_INPUT_REQUIRED')
      return fs.readFileSync(fd)
    } finally { fs.closeSync(fd) }
  }
  const manifestBytes = protectedRead(path.join(directory, 'manifest.json')), manifest = JSON.parse(manifestBytes)
  const anchorBytes = protectedRead(path.join(directory, flags.anchors))
  if (sha256(anchorBytes) !== flags['anchors-sha256']) throw new Error('EXACT_MEDIA_INVENTORY_ANCHOR_HASH_REQUIRED')
  const anchorReport = JSON.parse(anchorBytes), datasets = [...new Set(flags.datasets.split(','))].sort()
  if (manifest.complete !== true || manifest.run !== run || anchorReport.complete !== true || anchorReport.passed !== true || anchorReport.candidateManifestHash !== sha256(manifestBytes) || anchorReport.sourceHash !== sourceCollectionsHash(manifest.collections)) throw new Error('MEDIA_INVENTORY_SOURCE_BINDING_MISMATCH')
  let lastArchiveProgress = 0
  const entries = await loadIndexedEntries(directory, manifest, { onProgress: counters => {
    if (Date.now() - lastArchiveProgress >= 5000 || counters.collections === manifest.collections.length) {
      lastArchiveProgress = Date.now()
      console.error(JSON.stringify({ event: 'media-inventory-archive-progress', collectionsRead: counters.collections, collectionsPlanned: manifest.collections.length, archiveEntries: counters.archiveEntries }))
    }
  } })
  try {
    const plan = collectMediaPlan(entries, datasets)
    if (anchorReport.referenceHash !== plan.report.referenceHash) throw new Error('MEDIA_INVENTORY_REFERENCE_BINDING_MISMATCH')
    const readEnv = file => fs.existsSync(path.join(root, file)) ? dotenv.parse(fs.readFileSync(path.join(root, file))) : {}
    const env = { ...readEnv('.env'), ...readEnv('.env.local'), ...process.env }
    // Parsed local env values are not injected into process.env. The explicit
    // static token wins unless the SDK's actual process environment enables
    // OIDC store resolution. An unrelated pulled OIDC value is not used.
    if (!env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID) throw new Error('EXPLICIT_UNAMBIGUOUS_BLOB_TOKEN_REQUIRED')
    const { list } = require('@vercel/blob')
    const inventory = await inventoryMedia(plan, { maxPages: Number(flags['max-pages']), anchors: anchorReport.results, listBlob: options => list({ ...options, token: env.BLOB_READ_WRITE_TOKEN }), onProgress: counters => console.error(JSON.stringify({ event: 'scoped-media-inventory-progress', ...counters })) })
    entries.assertUnchanged()
    const result = { ...inventory, descriptorPlanPassed: plan.report.descriptorPlanPassed, run, datasets, candidateManifestHash: sha256(manifestBytes), sourceHash: sourceCollectionsHash(manifest.collections), sourceHashVersion: 'canonical-sorted-collections-v1', anchorReportHash: sha256(anchorBytes) }
    fs.writeFileSync(path.join(directory, flags.output), JSON.stringify(result, null, 2), { mode: 0o600, flag: 'wx' })
    console.log(JSON.stringify({ event: 'scoped-media-inventory-complete', complete: true, pagesRead: result.pagesRead, objectsListed: result.objectsListed, requiredObjects: result.requiredObjects, objectsAvailable: result.objectsAvailable, failedObjects: result.failedObjects, mediaBytesRead: 0, writes: 0, checksumVerificationPerformed: false }))
  } finally { entries.close() }
}
if (require.main === module) main().catch(error => { console.error(JSON.stringify({ event: 'scoped-media-inventory-failed', code: /^[A-Z][A-Z_]{1,100}$/.test(error.message || '') ? error.message : 'MEDIA_INVENTORY_FAILED', privateDetailsOmitted: true })); process.exitCode = 1 })
module.exports = { inventoryPrefixes, inventoryMedia }
