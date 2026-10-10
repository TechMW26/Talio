const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sha256, canonical, materializeRecord } = require('../../scripts/mongodb-migration/core.cjs')
const { sourceCollectionsHash } = require('../../scripts/mongodb-migration/migrate.cjs')
const { collectMediaPlan } = require('../../scripts/mongodb-migration/verify-media.cjs')
const { createMediaDisposition, loadDispositionLedger, DECISION } = require('../../scripts/mongodb-migration/media-disposition.cjs')
const { encodeApplicationRecord, decodeApplicationRecord, pack, unpack } = require('../../lib/platform/firestoreCodec.cjs')
const dataset = 'live-example', database = 'talio_company_example'
const fileId = '123456789012345678901234', galleryId = '223456789012345678901234', businessId = '323456789012345678901234'
const target = { host: 'example.mongodb.net', databaseName: 'talio' }
const missingPath = `tenants/${database}/screenshots/${dataset}/private.png`
const availablePath = `tenants/${database}/screenshots/${dataset}/available.png`
const descriptor = pathname => ({ pathname, database, bucket: 'screenshots', provider: 'vercel-blob', access: 'private', length: 200, sha256: sha256('content') })
function fixture({ backup = false } = {}) {
  const entries = new Map(), fields = pack({})
  const entry = (name, application) => ({ path: name, exists: true, fields, sha256: sha256(JSON.stringify(fields)), updateTime: null, application: pack(application) })
  const catalog = `talioDatasets/${dataset}`
  entries.set(catalog, entry(catalog, {}))
  function add(collection, record, metadata = {}, db = database) {
    const encoded = encodeApplicationRecord(record), name = `talioDatasets/${dataset}/databases/${db}/collections/${collection}/records/${record._id}`
    entries.set(name, entry(name, { ...encoded.envelope, ...metadata }))
    for (const part of encoded.parts) entries.set(`${name}/parts/${part.id}`, entry(`${name}/parts/${part.id}`, part.value))
  }
  const backupPath = `migrations/talio-hrms/source-run/media/${Buffer.from(database).toString('base64url')}/${Buffer.from('screenshots').toString('base64url')}/${sha256(JSON.stringify({ $oid: fileId }))}`
  add('screenshots.files', { _id: fileId, length: 200, storage: descriptor(missingPath) }, backup ? { media: descriptor(backupPath) } : {})
  add('screenshots', { _id: galleryId, gridfsFileId: fileId, url: `/api/images/${fileId}`, employee: businessId })
  add('productivitysessions', { _id: businessId, screenshots: [{ screenshotId: galleryId, fileId, url: missingPath }, { url: availablePath }], screenshotCount: 2, status: 'completed', workHours: 8, nested: { text: 'keep me' } })
  add('tasks', { _id: fileId, title: 'Unrelated task', fileId }, { digest: 'stale-legacy-digest' })
  add('employees', { _id: businessId, avatar: `/api/screenshots/${fileId}` }, {}, 'another_company')
  const manifest = { run: 'mongo-offline-tests', complete: true, collections: [] }, candidateManifestHash = sha256(JSON.stringify(manifest))
  const plan = collectMediaPlan(entries, [dataset])
  const inventory = { command: 'scoped-blob-media-inventory', complete: true, inventoryHash: sha256('listing'), run: manifest.run, datasets: [dataset], candidateManifestHash, sourceHash: sourceCollectionsHash(manifest.collections), sourceHashVersion: 'canonical-sorted-collections-v1', descriptorPlanPassed: true, referenceHash: plan.report.referenceHash, requiredObjects: plan.objects.length, objectsAvailable: plan.objects.length - 1, failedObjects: 1, omittedFailureKeys: 0, failures: [{ keyHash: sha256(missingPath), code: 'BLOB_OBJECT_UNAVAILABLE' }] }
  const inventoryBytes = Buffer.from(JSON.stringify(inventory)), changes = []
  const options = { datasets: [dataset], expectedInventoryHash: sha256(inventoryBytes), candidateManifestHash, decision: DECISION, target, onChange: value => changes.push(value) }
  return { entries, manifest, plan, inventory, inventoryBytes, options, changes, backupPath, add }
}
const decoded = change => { const native = unpack(change.after); return decodeApplicationRecord(native.envelope, new Map(native.parts.map(part => [part.id, part.value]))) }
function saveLedger(data) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'talio-disposition-test-')); fs.chmodSync(directory, 0o700)
  const report = createMediaDisposition(data.entries, data.manifest, data.inventoryBytes, data.options)
  const lines = data.changes.map(change => JSON.stringify(change) + '\n').join('')
  report.ledgerSha256 = sha256(lines)
  fs.writeFileSync(path.join(directory, 'changes.ndjson'), lines, { mode: 0o600 })
  const bytes = Buffer.from(JSON.stringify(report))
  fs.writeFileSync(path.join(directory, 'report.json'), bytes, { mode: 0o600 })
  const bindings = { expectedDispositionHash: sha256(bytes), ...report, entries: data.entries, manifest: data.manifest, inventoryBytes: data.inventoryBytes }
  return { directory, report, bindings }
}
test('removes only unavailable repository/gallery records and references, preserves business rows and source backups', () => {
  const data = fixture(), before = canonical([...data.entries])
  const report = createMediaDisposition(data.entries, data.manifest, data.inventoryBytes, data.options)
  expect(report).toMatchObject({ changedRecords: 3, repositoryTombstones: 1, deletedGalleryRecords: 1, sourceArchiveUnmodified: true, providerReads: 0, mediaWrites: 0, decision: DECISION, userAuthorization: DECISION })
  expect(data.changes.filter(change => change.after === null)).toHaveLength(2)
  expect(decoded(data.changes.find(change => change.after))).toMatchObject({ screenshots: [{ url: availablePath }], screenshotCount: 1, status: 'completed', workHours: 8, nested: { text: 'keep me' } })
  expect(canonical([...data.entries])).toBe(before)
  expect(data.changes.every(change => change.sourceEntries[0].path && change.before && change.beforeHash)).toBe(true)
  expect(JSON.stringify(report)).not.toContain(missingPath)
  expect(JSON.stringify(report)).not.toContain('keep me')
})
test('retains exact same-record available immutable backup without copying bytes', () => {
  const data = fixture({ backup: true }), report = createMediaDisposition(data.entries, data.manifest, data.inventoryBytes, data.options)
  expect(report).toMatchObject({ restoredRepositoryRecords: 1, repositoryTombstones: 0, deletedGalleryRecords: 0, mediaWrites: 0 })
  const repository = data.changes.find(change => change.reason === 'retain-owned-available-immutable-backup')
  expect(decoded(repository).storage.pathname).toBe(data.backupPath)
  expect(data.changes.some(change => change.after === null)).toBe(false)
})
test('preserves every overflow source part and re-encodes unrelated large values exactly', () => {
  const data = fixture(), large = 'unchanged-private-notes-'.repeat(20000)
  data.add('productivitysessions', { _id: businessId, screenshots: [{ url: missingPath }, { url: availablePath }], screenshotCount: 2, large })
  createMediaDisposition(data.entries, data.manifest, data.inventoryBytes, data.options)
  const change = data.changes.find(value => value.after)
  expect(change.sourceEntries.length).toBeGreaterThan(1)
  expect(decoded(change)).toMatchObject({ large, screenshotCount: 1, screenshots: [{ url: availablePath }] })
  for (const entry of change.sourceEntries) expect(data.entries.get(entry.path)).toEqual(entry)
})
test('omits previously deleted repository rows whose required immutable backup is confirmed unavailable', () => {
  const data = fixture({ backup: true })
  data.add('screenshots.files', { _id: fileId, length: 200, storage: descriptor(missingPath) }, { media: descriptor(data.backupPath), mediaState: 'deleted' })
  const plan = collectMediaPlan(data.entries, [dataset])
  const inventory = { ...data.inventory, referenceHash: plan.report.referenceHash, requiredObjects: plan.objects.length, objectsAvailable: plan.objects.length - 1, failures: [{ keyHash: sha256(data.backupPath), code: 'BLOB_OBJECT_UNAVAILABLE' }] }
  const bytes = Buffer.from(JSON.stringify(inventory))
  const report = createMediaDisposition(data.entries, data.manifest, bytes, { ...data.options, expectedInventoryHash: sha256(bytes) })
  expect(report).toMatchObject({ deletedRepositoryRecords: 1, deletedGalleryRecords: 1 })
  expect(data.changes.filter(change => change.after === null)).toHaveLength(2)
})
test('cleans scoped image API references without confusing unrelated media or business IDs', () => {
  const data = fixture(), imagePath = `tenants/${database}/images/${dataset}/missing-avatar.png`
  data.add('images.files', { _id: fileId, length: 200, storage: { ...descriptor(imagePath), bucket: 'images' } })
  data.add('employees', { _id: businessId, profilePicture: `/api/images/${fileId}`, title: 'Preserved', imageId: fileId })
  const plan = collectMediaPlan(data.entries, [dataset]), inventory = { ...data.inventory, referenceHash: plan.report.referenceHash, requiredObjects: plan.objects.length, objectsAvailable: plan.objects.length - 2, failedObjects: 2, failures: [...data.inventory.failures, { keyHash: sha256(imagePath), code: 'BLOB_OBJECT_UNAVAILABLE' }] }
  const bytes = Buffer.from(JSON.stringify(inventory))
  createMediaDisposition(data.entries, data.manifest, bytes, { ...data.options, expectedInventoryHash: sha256(bytes) })
  const employee = data.changes.find(value => value.after && unpack(value.after).collectionName === 'employees')
  expect(decoded(employee)).toEqual({ _id: businessId, title: 'Preserved' })
  expect(data.changes.some(value => unpack(value.before).collectionName === 'tasks')).toBe(false)
})
test.each([
  ['omittedFailureKeys', 1], ['failedObjects', 522], ['referenceHash', sha256('wrong')], ['sourceHash', sha256('wrong')], ['datasets', ['other-example']],
])('rejects incomplete or wrong scoped inventory before any output: %s', (key, value) => {
  const data = fixture(), bytes = Buffer.from(JSON.stringify({ ...data.inventory, [key]: value }))
  expect(() => createMediaDisposition(data.entries, data.manifest, bytes, { ...data.options, expectedInventoryHash: sha256(bytes) })).toThrow()
  expect(data.changes).toHaveLength(0)
})
test('requires exact authorization, target and inventory bytes; no transient failures are deleted', () => {
  const data = fixture()
  expect(() => createMediaDisposition(data.entries, data.manifest, data.inventoryBytes, { ...data.options, decision: 'delete-all' })).toThrow('DECISION_AND_TARGET')
  expect(() => createMediaDisposition(data.entries, data.manifest, data.inventoryBytes, { ...data.options, target: { ...target, databaseName: 'admin' } })).toThrow('DECISION_AND_TARGET')
  expect(() => createMediaDisposition(data.entries, data.manifest, data.inventoryBytes, { ...data.options, expectedInventoryHash: sha256('wrong') })).toThrow('INVENTORY_HASH')
  const bytes = Buffer.from(JSON.stringify({ ...data.inventory, failures: [{ keyHash: sha256(missingPath), code: 'BLOB_READ_FAILED' }] }))
  expect(() => createMediaDisposition(data.entries, data.manifest, bytes, { ...data.options, expectedInventoryHash: sha256(bytes) })).toThrow('CONFIRMED_MISSING')
})
test('protected ledger regenerates deterministic operations, replays fresh passes and produces a clean media plan', async () => {
  const data = fixture(), saved = saveLedger(data)
  let ledger
  try {
    ledger = await loadDispositionLedger(saved.directory, saved.bindings)
    const overlay = ledger.createOverlay()
    expect(() => overlay.assertComplete()).toThrow('REPLAY_INCOMPLETE')
    const cleaned = collectMediaPlan(data.entries, [dataset], { nativeDisposition: overlay })
    expect(cleaned.report).toMatchObject({ descriptorPlanPassed: true, requiredObjects: 1, recordsScanned: 3 })
    expect(cleaned.objects[0].pathname).toBe(availablePath)
    expect(collectMediaPlan(data.entries, [dataset], { nativeDisposition: ledger.createOverlay() })).toEqual(cleaned)
    const wrong = ledger.createOverlay(), change = data.changes[0], before = unpack(change.before)
    expect(() => wrong.transform({ ...before, digest: sha256('changed') })).toThrow('BEFORE_RECORD_MISMATCH')
    const unchanged = materializeRecord([...data.entries.values()].find(value => value.path.includes('/collections/tasks/')), data.entries, dataset)
    expect(wrong.transform(unchanged)).toBe(unchanged)
  } finally { ledger?.close(); fs.rmSync(saved.directory, { recursive: true, force: true }) }
})
test('rejects altered reports, loose permissions, ledger changes and arbitrary rehashed business mutations', async () => {
  const data = fixture(), saved = saveLedger(data)
  try {
    await expect(loadDispositionLedger(saved.directory, { ...saved.bindings, target: { ...target, databaseName: 'other' } })).rejects.toThrow('BINDING_MISMATCH')
    fs.chmodSync(path.join(saved.directory, 'changes.ndjson'), 0o644)
    await expect(loadDispositionLedger(saved.directory, saved.bindings)).rejects.toThrow('PROTECTED_DISPOSITION_FILE')
    fs.chmodSync(path.join(saved.directory, 'changes.ndjson'), 0o600)
    const changed = data.changes.map(value => ({ ...value })), item = changed.find(value => value.after)
    const native = unpack(item.after); native.envelope.data.workHours = 0; item.after = pack(native); item.afterHash = sha256(canonical(native))
    const lines = changed.map(value => JSON.stringify(value) + '\n').join('')
    fs.writeFileSync(path.join(saved.directory, 'changes.ndjson'), lines)
    const report = { ...saved.report, ledgerSha256: sha256(lines) }, bytes = Buffer.from(JSON.stringify(report))
    fs.writeFileSync(path.join(saved.directory, 'report.json'), bytes)
    await expect(loadDispositionLedger(saved.directory, { ...saved.bindings, expectedDispositionHash: sha256(bytes) })).rejects.toThrow('NOT_DETERMINISTIC')
  } finally { fs.rmSync(saved.directory, { recursive: true, force: true }) }
})
test('detects ledger mutation after load and requires exact report hash', async () => {
  const data = fixture(), saved = saveLedger(data)
  let ledger
  try {
    await expect(loadDispositionLedger(saved.directory, { ...saved.bindings, expectedDispositionHash: sha256('wrong') })).rejects.toThrow('REPORT_HASH_REQUIRED')
    ledger = await loadDispositionLedger(saved.directory, saved.bindings)
    fs.appendFileSync(path.join(saved.directory, 'changes.ndjson'), '\n')
    expect(() => ledger.createOverlay().transform(unpack(data.changes[0].before))).toThrow('LEDGER_CHANGED')
  } finally { ledger?.close(); fs.rmSync(saved.directory, { recursive: true, force: true }) }
})
test('replay checks source files only at pass boundaries, not for each unchanged or changed record', async () => {
  const data = fixture(), saved = saveLedger(data)
  const assertUnchanged = jest.fn(); data.entries.assertUnchanged = assertUnchanged
  let ledger
  try {
    ledger = await loadDispositionLedger(saved.directory, saved.bindings)
    assertUnchanged.mockClear()
    const overlay = ledger.createOverlay(), unchanged = { dataset, databaseName: database, collectionName: 'tasks', recordKey: '9'.repeat(24) }
    for (let index = 0; index < 10000; index++) expect(overlay.transform(unchanged)).toBe(unchanged)
    for (const change of data.changes) overlay.transform(unpack(change.before))
    expect(assertUnchanged).not.toHaveBeenCalled()
    overlay.assertComplete()
    expect(assertUnchanged).toHaveBeenCalledTimes(1)
    const emptyPass = ledger.createOverlay()
    fs.appendFileSync(path.join(saved.directory, 'changes.ndjson'), '\n')
    expect(emptyPass.transform(unchanged)).toBe(unchanged)
    expect(() => emptyPass.assertComplete()).toThrow('LEDGER_CHANGED')
  } finally { ledger?.close(); fs.rmSync(saved.directory, { recursive: true, force: true }) }
})
test('rejects symlinked protected report/ledger and detects report replacement after validation', async () => {
  const data = fixture(), saved = saveLedger(data)
  let ledger
  try {
    const filename = path.join(saved.directory, 'changes.ndjson'), moved = path.join(saved.directory, 'original.ndjson')
    fs.renameSync(filename, moved); fs.symlinkSync(moved, filename)
    await expect(loadDispositionLedger(saved.directory, saved.bindings)).rejects.toThrow('PROTECTED_DISPOSITION_FILE_REQUIRED')
    fs.unlinkSync(filename); fs.renameSync(moved, filename)
    ledger = await loadDispositionLedger(saved.directory, saved.bindings)
    const reportFile = path.join(saved.directory, 'report.json')
    fs.renameSync(reportFile, path.join(saved.directory, 'old-report.json'))
    fs.writeFileSync(reportFile, JSON.stringify(saved.report), { mode: 0o600 })
    expect(() => ledger.createOverlay().assertComplete()).toThrow('REPORT_OR_DIRECTORY_CHANGED')
  } finally { ledger?.close(); fs.rmSync(saved.directory, { recursive: true, force: true }) }
})
