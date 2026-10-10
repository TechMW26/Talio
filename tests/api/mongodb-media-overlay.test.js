const { pack, unpack, encodeApplicationRecord, recordDigest } = require('../../lib/platform/firestoreCodec.cjs')
const { sha256, canonical, materializeRecord, materializeCatalog, archiveDocument } = require('../../scripts/mongodb-migration/core.cjs')
const { importMongo, planMongo, loadNativeDisposition, sourceCollectionsHash } = require('../../scripts/mongodb-migration/migrate.cjs')
const { createMediaDisposition } = require('../../scripts/mongodb-migration/media-disposition.cjs')
const { collectMediaPlan, verifyMediaObjects } = require('../../scripts/mongodb-migration/verify-media.cjs')
const { memoryMongoDriver } = require('../helpers/mongoDriver')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')

const dataset = 'live-overlay-tests', databaseName = 'talio_company_overlay', run = 'mongo-overlay-tests'
const clone = value => unpack(pack(value))
const sourceEntry = (path, application) => ({ path, exists: true, fields: { value: { stringValue: 'unchanged raw source' } }, sha256: sha256(JSON.stringify({ value: { stringValue: 'unchanged raw source' } })), updateTime: { seconds: 1, nanoseconds: 1 }, application: pack(application) })

function fixture() {
  const entries = new Map(), original = new Map(), changes = new Map()
  const add = (collectionName, record, metadata = {}) => {
    const encoded = encodeApplicationRecord(record), path = `talioDatasets/${dataset}/databases/${databaseName}/collections/${collectionName}/records/${record._id}`
    const entry = sourceEntry(path, { ...encoded.envelope, ...metadata }); entries.set(path, entry)
    for (const part of encoded.parts) entries.set(`${path}/parts/${part.id}`, sourceEntry(`${path}/parts/${part.id}`, part.value))
    const document = materializeRecord(entry, entries, dataset); original.set(document._id, document); return document
  }
  const profile = add('employees', { _id: '111111111111111111111111', firstName: 'Retained', profilePicture: `tenants/${databaseName}/images/${dataset}/missing.png` })
  const file = add('images.files', { _id: '222222222222222222222222', length: 10, storage: { provider: 'vercel-blob', access: 'private', database: databaseName, bucket: 'images', pathname: `tenants/${databaseName}/images/${dataset}/missing.png`, length: 10, sha256: sha256('missing') } })
  const gallery = add('screenshots', { _id: '333333333333333333333333', url: `tenants/${databaseName}/screenshots/${dataset}/missing.png` })
  const updated = (document, record, metadata = {}) => {
    const encoded = encodeApplicationRecord(record)
    return { ...document, envelope: { ...encoded.envelope, ...metadata }, parts: encoded.parts, digest: recordDigest(record) }
  }
  changes.set(profile._id, updated(profile, { _id: profile.recordKey, firstName: 'Retained' }))
  changes.set(file._id, updated(file, { _id: file.recordKey, length: 10 }, { mediaState: 'deleted' }))
  changes.set(gallery._id, null)
  entries.set(`talioDatasets/${dataset}`, sourceEntry(`talioDatasets/${dataset}`, { tenants: [] }))
  const manifest = { run, complete: true, collections: [] }, native = memoryMongoDriver()
  for (const entry of entries.values()) native.bank('talio_firestore_archive').set(sha256(JSON.stringify([run, entry.path])), archiveDocument(entry, run))
  for (const [id, document] of original) native.bank('talio_records').set(id, clone(document))
  native.bank('talio_catalogs').set(dataset, materializeCatalog(entries.get(`talioDatasets/${dataset}`)))
  const report = { decision: 'remove-unavailable-media-only', complete: true, deletedGalleryRecords: 1, changedRecords: 3, reportHash: 'a'.repeat(64) }
  function overlay() {
    const used = new Set()
    return { report, transform(document) {
      if (!changes.has(document._id)) return document
      if (sha256(canonical(document)) !== sha256(canonical(original.get(document._id)))) throw new Error('EXACT_NATIVE_BEFORE_HASH_REQUIRED')
      if (used.has(document._id)) throw new Error('DUPLICATE_DISPOSITION_RECORD')
      used.add(document._id); return clone(changes.get(document._id))
    }, assertComplete() { if (used.size !== changes.size) throw new Error('UNUSED_DISPOSITION_CHANGES') } }
  }
  return { ...native, entries, manifest, original, changes, overlay, report }
}

test('cleaned parity remains exact while raw source archives are never rewritten', async () => {
  const value = fixture(), rawBefore = canonical([...value.bank('talio_firestore_archive').values()])
  for (const [id, after] of value.changes) after ? value.bank('talio_records').set(id, clone(after)) : value.bank('talio_records').delete(id)
  await expect(importMongo(value.db, value.entries, value.manifest, [dataset], true)).rejects.toThrow('RECORD_MISMATCH')
  const result = await importMongo(value.db, value.entries, value.manifest, [dataset], true, { nativeDisposition: value.overlay() })
  expect(result).toMatchObject({ verified: true, rawSourceIntegrityUnmodified: true, sourceRecordCount: 3, recordCount: 2, transformedRecordCount: 2, omittedRecordCount: 1, mediaDisposition: value.report })
  expect(canonical([...value.bank('talio_firestore_archive').values()])).toBe(rawBefore)
  expect(planMongo(value.entries, value.manifest, [dataset], { nativeDisposition: value.overlay() })).toMatchObject({ recordCount: 2, sourceRecordCount: 3, omittedRecordCount: 1, transformedRecordCount: 2 })
})

test('overlay never becomes a silent skip/import mode and cannot change tenant/native identity', async () => {
  const value = fixture()
  await expect(importMongo(null, value.entries, value.manifest, [dataset], false, { nativeDisposition: value.overlay() })).rejects.toThrow('VERIFY_ONLY_NOT_IMPORT')
  const malformed = value.overlay(); malformed.transform = document => ({ ...document, databaseName: 'talio_company_foreign' })
  expect(() => planMongo(value.entries, value.manifest, [dataset], { nativeDisposition: malformed })).toThrow('IDENTITY_CHANGED')
  expect(() => planMongo(value.entries, value.manifest, [dataset], { nativeDisposition: { ...value.overlay(), report: { complete: true, decision: 'delete-anything' } } })).toThrow('AUDITED_MEDIA_DISPOSITION')
})

test('leftover deleted media IDs and unrelated extras still fail cleaned parity', async () => {
  const value = fixture()
  for (const [id, after] of value.changes) if (after) value.bank('talio_records').set(id, clone(after))
  await expect(importMongo(value.db, value.entries, value.manifest, [dataset], true, { nativeDisposition: value.overlay() })).rejects.toThrow('OMITTED_MEDIA_RECORD_STILL_PRESENT')
  for (const [id, after] of value.changes) if (!after) value.bank('talio_records').delete(id)
  value.bank('talio_records').set('unrelated-extra', { _id: 'unrelated-extra', dataset })
  await expect(importMongo(value.db, value.entries, value.manifest, [dataset], true, { nativeDisposition: value.overlay() })).rejects.toThrow('TOTAL_COUNT_MISMATCH')
})

test('available-only media verification does not falsely claim full source media integrity', async () => {
  const value = fixture()
  const plan = collectMediaPlan(value.entries, [dataset], { nativeDisposition: value.overlay() })
  expect(plan.report).toMatchObject({ descriptorPlanPassed: true, requiredObjects: 0, tombstonedRepositoryRecords: 1, recordsScanned: 2 })
  const readBlob = jest.fn()
  const verified = await verifyMediaObjects(plan, { readBlob, maximumBytes: 10 })
  expect(verified).toMatchObject({ passed: true, availableMediaIntegrityVerified: true, fullSourceIntegrityVerified: false, mediaDisposition: value.report })
  expect(readBlob).not.toHaveBeenCalled()
})

test('an unconsumed disposition ledger is never accepted as complete', () => {
  const value = fixture(); value.changes.set('not-in-source', null)
  expect(() => planMongo(value.entries, value.manifest, [dataset], { nativeDisposition: value.overlay() })).toThrow('UNUSED_DISPOSITION')
})

test('protected CLI overlay loader regenerates the source-ledger transform, then verifies exact cleaned target parity', async () => {
  const value = fixture(), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'talio-overlay-cli-')), target = { host: 'cluster.example.mongodb.net', databaseName: 'talio' }
  fs.chmodSync(directory, 0o700)
  const manifestBytes = Buffer.from(JSON.stringify(value.manifest)), mediaPlan = collectMediaPlan(value.entries, [dataset])
  const inventory = { command: 'scoped-blob-media-inventory', complete: true, inventoryHash: sha256('synthetic-listing'), run, datasets: [dataset], candidateManifestHash: sha256(manifestBytes), sourceHash: sourceCollectionsHash(value.manifest.collections), sourceHashVersion: 'canonical-sorted-collections-v1', descriptorPlanPassed: true, referenceHash: mediaPlan.report.referenceHash, requiredObjects: mediaPlan.objects.length, objectsAvailable: 0, failedObjects: mediaPlan.objects.length, omittedFailureKeys: 0, failures: mediaPlan.objects.map(object => ({ keyHash: object.keyHash, code: 'BLOB_OBJECT_UNAVAILABLE' })) }
  const inventoryBytes = Buffer.from(JSON.stringify(inventory)), changes = []
  const report = createMediaDisposition(value.entries, value.manifest, inventoryBytes, { datasets: [dataset], expectedInventoryHash: sha256(inventoryBytes), candidateManifestHash: sha256(manifestBytes), decision: 'remove-unavailable-media-only', target, onChange: change => changes.push(change) })
  const ledgerBytes = Buffer.from(changes.map(change => JSON.stringify(change) + '\n').join(''))
  report.ledgerSha256 = sha256(ledgerBytes)
  const reportBytes = Buffer.from(JSON.stringify(report)), inventoryFile = path.join(directory, 'inventory.json')
  fs.writeFileSync(path.join(directory, 'changes.ndjson'), ledgerBytes, { mode: 0o600 }); fs.writeFileSync(path.join(directory, 'report.json'), reportBytes, { mode: 0o600 }); fs.writeFileSync(inventoryFile, inventoryBytes, { mode: 0o600 })
  const flags = { disposition: directory, 'disposition-sha256': sha256(reportBytes), inventory: inventoryFile, 'inventory-sha256': sha256(inventoryBytes), decision: 'remove-unavailable-media-only' }
  let ledger
  try {
    await expect(loadNativeDisposition(value.entries, value.manifest, manifestBytes, [dataset], { ...flags, decision: 'delete-everything' }, target)).rejects.toThrow('EXACT_PROTECTED')
    fs.chmodSync(inventoryFile, 0o644)
    await expect(loadNativeDisposition(value.entries, value.manifest, manifestBytes, [dataset], flags, target)).rejects.toThrow('PROTECTED_OWNED')
    fs.chmodSync(inventoryFile, 0o600)
    ledger = await loadNativeDisposition(value.entries, value.manifest, manifestBytes, [dataset], flags, target)
    for (const change of changes) {
      const before = unpack(change.before), after = change.after === null ? null : unpack(change.after)
      after ? value.bank('talio_records').set(before._id, after) : value.bank('talio_records').delete(before._id)
    }
    const parity = await importMongo(value.db, value.entries, value.manifest, [dataset], true, { nativeDisposition: ledger.createOverlay() })
    expect(parity).toMatchObject({ verified: true, omittedRecordCount: report.deletedNativeRecords, rawSourceIntegrityUnmodified: true, mediaDisposition: ledger.binding })
    const availablePlan = collectMediaPlan(value.entries, [dataset], { nativeDisposition: ledger.createOverlay() })
    expect(availablePlan.report).toMatchObject({ requiredObjects: 0, descriptorPlanPassed: true, mediaDisposition: ledger.binding })
    const raw = [...value.bank('talio_firestore_archive').values()][0]; raw.sha256 = sha256('tampered')
    await expect(importMongo(value.db, value.entries, value.manifest, [dataset], true, { nativeDisposition: ledger.createOverlay() })).rejects.toThrow('ARCHIVE_IDENTITY_OR_PAYLOAD')
  } finally { ledger?.close(); fs.rmSync(directory, { recursive: true, force: true }) }
})
