const { validateChanges, applyDisposition } = require('../../scripts/mongodb-migration/apply-media-disposition.cjs')
const { sha256, canonical } = require('../../scripts/mongodb-migration/core.cjs')
const { pack, unpack } = require('../../lib/platform/firestoreCodec.cjs')
const dataset = 'live-example', run = 'mongo-example-run'
const before = { _id: 'a'.repeat(64), dataset, databaseName: 'talio_company_example', collectionName: 'screenshots.files', recordKey: '1'.repeat(24), envelope: { data: { length: 10 } }, parts: [], digest: 'd'.repeat(64) }
const clone = value => unpack(pack(value))
function fixture(collectionName = before.collectionName) {
  const original = { ...before, collectionName }
  const change = { recordKeyHash: 'b'.repeat(64), reason: 'remove-unavailable-repository-record', beforeHash: sha256(canonical(original)), afterHash: null, before: pack(original), after: null }
  const operationsHash = sha256(JSON.stringify([change.recordKeyHash, change.reason, change.beforeHash, change.afterHash]) + '\n')
  return { changes: [change], report: { command: 'offline-media-disposition', complete: true, userAuthorization: 'remove-unavailable-media-only', sourceArchiveUnmodified: true, run, datasets: [dataset], changedRecords: 1, operationsHash } }
}
function driver() {
  const banks = new Map(), bank = name => { if (!banks.has(name)) banks.set(name, new Map()); return banks.get(name) }
  const match = (value, filter) => Object.entries(filter).every(([key, wanted]) => wanted?.$in ? wanted.$in.includes(value[key]) : value[key] === wanted)
  const db = { collection(name) { return {
    async findOne(filter) { return clone([...bank(name).values()].find(value => match(value, filter)) || null) },
    find(filter) { return { async toArray() { return [...bank(name).values()].filter(value => match(value, filter)).map(clone) } } },
    async updateOne(filter, update, options) { let value = [...bank(name).values()].find(value => match(value, filter)); if (!value && options?.upsert) { value = { ...filter, ...update.$setOnInsert }; bank(name).set(value._id, value) } if (!value) return { matchedCount: 0 }; Object.assign(value, update.$set); return { matchedCount: 1 } },
    async insertOne(value) { if (bank(name).has(value._id)) throw new Error('duplicate'); bank(name).set(value._id, clone(value)) },
    async deleteOne(filter) { const value = [...bank(name).values()].find(value => match(value, filter)); if (value) bank(name).delete(value._id); return { deletedCount: value ? 1 : 0 } },
    async replaceOne(filter, value) { const old = [...bank(name).values()].find(value => match(value, filter)); if (old) bank(name).set(old._id, clone(value)); return { matchedCount: old ? 1 : 0 } },
  } } }
  const client = { startSession() { return { async withTransaction(action, options) { expect(options.readConcern.level).toBe('snapshot'); expect(options.writeConcern.w).toBe('majority'); const backup = new Map([...banks].map(([name, values]) => [name, new Map([...values].map(([key, value]) => [key, clone(value)]))])); try { await action() } catch (error) { banks.clear(); for (const [name, values] of backup) banks.set(name, values); throw error } }, async endSession() {} } } }
  bank('talio_catalogs').set(dataset, { _id: dataset, mongoVerified: false, applicationCutover: false })
  bank('talio_records').set(before._id, clone(before))
  return { db, client, bank }
}
test('exact authorized cleanup deletes only target metadata and verifies resumable after-state', async () => {
  const f = fixture(), d = driver(), args = { ...d, ...f, reportHash: 'e'.repeat(64), prepareFence: true }
  expect(await applyDisposition(args)).toMatchObject({ complete: true, changedRecords: 1, afterImagesVerified: 1, sourceWrites: 0, mediaWrites: 0, catalogsActivated: false, finalCutoverComplete: false })
  expect(d.bank('talio_records').size).toBe(0)
  expect(await applyDisposition(args)).toMatchObject({ changedRecords: 0, resumedRecords: 1 })
})
test('fails before cleanup on active catalog', async () => {
  const d = driver(); d.bank('talio_catalogs').get(dataset).applicationCutover = true
  await expect(applyDisposition({ ...d, ...fixture(), reportHash: 'e'.repeat(64), prepareFence: true })).rejects.toThrow('NON_WRITABLE')
  expect(d.bank('talio_records').size).toBe(1)
})
test('concurrent before-image mismatch cannot delete a changed record or commit checkpoint', async () => {
  const d = driver(); d.bank('talio_records').get(before._id).digest = 'changed'
  await expect(applyDisposition({ ...d, ...fixture(), reportHash: 'e'.repeat(64), prepareFence: true })).rejects.toThrow('BEFORE_IMAGE_MISMATCH')
  expect(d.bank('talio_records').size).toBe(1)
  expect([...d.bank('talio_migration_controls').keys()]).toEqual(['write-fence'])
})
test('unauthorized, corrupt and non-media deletes are rejected before mutations', () => {
  const f = fixture()
  expect(() => validateChanges(f.changes, { ...f.report, userAuthorization: 'skip-everything' })).toThrow('AUTHORIZED')
  expect(() => validateChanges([{ ...f.changes[0], afterHash: 'x' }], f.report)).toThrow('IDENTITY')
  const business = fixture('employees')
  expect(() => validateChanges(business.changes, business.report)).toThrow('BUSINESS_RECORD_DELETION_FORBIDDEN')
})
