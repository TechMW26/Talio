const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { gunzipSync } = require('node:zlib')
const { BSON } = require('bson')
const { encodeApplicationRecord, pack, unpack } = require('../../lib/platform/firestoreCodec.cjs')
const { sha256, canonical, archiveDocument, materializeRecord } = require('../../scripts/mongodb-migration/core.cjs')
const { targetDocuments } = require('../../scripts/mongodb-migration/reconcile.cjs')
const { importMongo, resolveSharedArchiveDocuments, sourceCollectionsHash } = require('../../scripts/mongodb-migration/migrate.cjs')
const { applyDelta, buildDeltaOperations, iterateDeltaOperations, boundedBatches, summarizeDeltaOperations } = require('../../scripts/mongodb-migration/apply-delta.cjs')

const dataset = 'live-example', baselineRun = 'mongo-baseline-123', candidateRun = 'mongo-final-123'
const databaseName = 'talio_company_example'
const clone = value => unpack(pack(value))
const entry = (documentPath, value) => ({ path: documentPath, exists: true, fields: pack(value), application: pack(value), sha256: sha256(JSON.stringify(pack(value))), updateTime: { seconds: 1, nanoseconds: 0 } })
function sourceEntries(records) {
  const catalogPath = `talioDatasets/${dataset}`
  const values = new Map([[catalogPath, entry(catalogPath, { tenants: [{ databaseName }], purpose: 'production', status: 'ready', applicationCutover: true })]])
  for (const record of records) {
    const recordPath = `${catalogPath}/databases/${databaseName}/collections/users/records/${record._id}`
    const encoded = encodeApplicationRecord(record)
    values.set(recordPath, entry(recordPath, encoded.envelope))
    for (const part of encoded.parts) values.set(`${recordPath}/parts/${part.id}`, entry(`${recordPath}/parts/${part.id}`, part.value))
  }
  return values
}
function memoryMongo(before) {
  const banks = new Map(), control = { failBulk: false, transactions: 0 }
  const bank = name => { if (!banks.has(name)) banks.set(name, new Map()); return banks.get(name) }
  const matches = (doc, filter) => Object.entries(filter).every(([field, value]) => value && typeof value === 'object' && '$in' in value ? value.$in.includes(doc[field]) : doc[field] === value)
  const db = { collection(name) {
    return {
      findOne: async filter => [...bank(name).values()].find(doc => matches(doc, filter)) || null,
      find: filter => ({ toArray: async () => [...bank(name).values()].filter(doc => matches(doc, filter)) }),
      countDocuments: async filter => [...bank(name).values()].filter(doc => matches(doc, filter)).length,
      updateOne: async (filter, update, options = {}) => {
        const saved = [...bank(name).values()].find(doc => matches(doc, filter))
        if (saved) { Object.assign(saved, clone(update.$set || {})); return { matchedCount: 1 } }
        if (options.upsert) { bank(name).set(filter._id, clone({ ...filter, ...update.$setOnInsert, ...update.$set })); return { matchedCount: 0, upsertedCount: 1 } }
        return { matchedCount: 0 }
      },
      insertOne: async document => { if (bank(name).has(document._id)) throw new Error('DUPLICATE'); bank(name).set(document._id, clone(document)); return { insertedId: document._id } },
      bulkWrite: async operations => {
        const result = { insertedCount: 0, deletedCount: 0, matchedCount: 0 }
        for (const operation of operations) {
          if (operation.insertOne) { const doc = operation.insertOne.document; if (bank(name).has(doc._id)) throw new Error('DUPLICATE'); bank(name).set(doc._id, clone(doc)); result.insertedCount++ }
          else if (operation.deleteOne) { if (bank(name).delete(operation.deleteOne.filter._id)) result.deletedCount++ }
          else if (operation.replaceOne) { if (bank(name).has(operation.replaceOne.filter._id)) { bank(name).set(operation.replaceOne.filter._id, clone(operation.replaceOne.replacement)); result.matchedCount++ } }
          if (control.failBulk) throw new Error('SIMULATED_BULK_FAILURE')
        }
        return result
      },
    }
  } }
  const client = { startSession: () => ({ withTransaction: async callback => {
    control.transactions++
    const snapshot = new Map([...banks].map(([name, values]) => [name, new Map([...values].map(([key, value]) => [key, clone(value)]))]))
    try { return await callback() } catch (error) { banks.clear(); for (const [name, values] of snapshot) banks.set(name, values); throw error }
  }, endSession: async () => {} }) }
  for (const value of before.values()) { const document = archiveDocument(value, baselineRun); bank('talio_firestore_archive').set(document._id, document) }
  for (const { bank: name, document } of targetDocuments(before, [dataset]).values()) bank(name).set(document._id, clone(document))
  bank('talio_migration_controls').set('write-fence', { _id: 'write-fence', active: true, baselineRun, candidateRun, datasets: [dataset] })
  return { db, client, banks, control, bank }
}
const args = (mongo, before, after, recoveryDir) => ({ ...mongo, before, after, baselineRun, candidateRun, datasets: [dataset], recoveryDir, baselineManifestHash: 'a'.repeat(64), candidateManifestHash: 'b'.repeat(64) })

describe('bounded optimistic Mongo final delta', () => {
  const original = { _id: '123456789012345678901234', name: 'before', password: 'already-hashed', nested: [[1, 2]] }
  test('streams the exact canonical operation hash without retaining payload batches', () => {
    const before = sourceEntries([original]), after = sourceEntries([{ ...original, name: 'after' }])
    const make = () => iterateDeltaOperations(before, after, baselineRun, candidateRun, [dataset])
    const collected = buildDeltaOperations(before, after, baselineRun, candidateRun, [dataset])
    const metadata = collected.map(({ bank, id, action, beforeHash, afterHash }) => ({ bank, id, action, beforeHash, afterHash }))
    expect(summarizeDeltaOperations(make, 2, 8 * 1024 * 1024)).toEqual({ operationsHash: sha256(canonical(metadata)), operations: collected.length, batches: boundedBatches(collected, 2).length })
    expect(summarizeDeltaOperations(() => [][Symbol.iterator](), 2, 1000)).toEqual({ operationsHash: sha256(canonical([])), operations: 0, batches: 0 })
  })
  test('target projection indexes identities without retaining or decoding record bodies', () => {
    const entries = sourceEntries([{ _id: original._id, name: 'example' }]), read = jest.spyOn(entries, 'get')
    const targets = targetDocuments(entries, [dataset])
    expect(read).not.toHaveBeenCalled()
    const recordKey = [...targets.keys()].find(key => key.startsWith('talio_records/'))
    expect(targets.get(recordKey).document.recordKey).toBe(original._id)
    expect(read).toHaveBeenCalledTimes(1)
    expect(targets.get('unknown')).toBeUndefined()
    read.mockRestore()
  })
  test('raw delta iteration reads only the yielded entry rather than the complete archive', () => {
    const before = sourceEntries([original]), after = sourceEntries([original]), read = jest.spyOn(after, 'get')
    const iterator = iterateDeltaOperations(before, after, baselineRun, candidateRun, [dataset])
    expect(read).not.toHaveBeenCalled()
    expect(iterator.next().value.bank).toBe('talio_firestore_archive')
    expect(read).toHaveBeenCalledTimes(1)
    iterator.return(); read.mockRestore()
  })
  test('binds source verification to the complete tree independent of child RPC ordering', () => {
    const collections = [{ path: 'z/sub/leaf', file: 'z', summary: { documents: 1, sha256: 'a' } }, { path: 'a', file: 'a', summary: { documents: 2, sha256: 'b' } }]
    expect(sourceCollectionsHash(collections)).toBe(sourceCollectionsHash([...collections].reverse()))
    expect(sourceCollectionsHash(collections)).not.toBe(sourceCollectionsHash([{ ...collections[0], summary: { documents: 2, sha256: 'a' } }, collections[1]]))
    expect(() => sourceCollectionsHash(null)).toThrow('SOURCE_COLLECTIONS')
  })
  test('aliases unchanged raw bytes, preserves baseline, replaces checked parts and removes stale live records', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-delta-'))
    const before = sourceEntries([original, { _id: '223456789012345678901234', name: 'removed' }])
    const after = sourceEntries([{ ...original, name: 'after', nested: [[3, 4]] }, { _id: '323456789012345678901234', name: 'inserted' }])
    const mongo = memoryMongo(before)
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const report = await applyDelta(args(mongo, before, after, dir))
      expect(report).toMatchObject({ targetWritesPerformed: true, mongoVerified: false, applicationCutover: false, fullVerificationRequired: true })
      const candidateRaw = [...mongo.bank('talio_firestore_archive').values()].filter(doc => doc.run === candidateRun)
      expect(candidateRaw).toHaveLength(after.size)
      expect(candidateRaw.some(doc => doc.sharedPayloadFrom && !doc.bytes)).toBe(true)
      expect([...mongo.bank('talio_firestore_archive').values()].filter(doc => doc.run === baselineRun)).toHaveLength(before.size)
      expect(await importMongo(mongo.db, after, { run: candidateRun, collections: [] }, [dataset], true)).toMatchObject({ verified: true, recordCount: 2 })
      const files = (await fs.readdir(dir)).filter(file => file.endsWith('.bson.gz'))
      const images = files.flatMap(file => BSON.deserialize(gunzipSync(require('node:fs').readFileSync(path.join(dir, file))), { promoteBuffers: true }).operations)
      expect(images.some(image => image.before?.envelope?.data?.name === 'removed')).toBe(true)
      expect((await fs.stat(path.join(dir, files[0]))).mode & 0o777).toBe(0o600)
      expect(log.mock.calls.map(call => call[0]).join('\n')).not.toContain('already-hashed')
    } finally { log.mockRestore(); await fs.rm(dir, { recursive: true, force: true }) }
  })
  test('resumes committed checkpoints without reapplying changes or replacing before-images', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-delta-resume-'))
    const before = sourceEntries([original]), after = sourceEntries([{ ...original, name: 'after' }]), mongo = memoryMongo(before)
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const first = await applyDelta({ ...args(mongo, before, after, dir), maxWrites: 2 })
      const imageNames = (await fs.readdir(dir)).filter(file => file.endsWith('.bson.gz'))
      const imageHashes = await Promise.all(imageNames.map(async file => sha256(await fs.readFile(path.join(dir, file)))))
      const resumed = await applyDelta({ ...args(mongo, before, after, dir), maxWrites: 2 })
      expect(resumed.resumed).toBe(first.batches)
      expect(resumed.applied).toBe(0)
      expect(await Promise.all(imageNames.map(async file => sha256(await fs.readFile(path.join(dir, file)))))).toEqual(imageHashes)
    } finally { log.mockRestore(); await fs.rm(dir, { recursive: true, force: true }) }
  })
  test('rejects unexpected target edits before any batch data mutation', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-delta-conflict-'))
    const before = sourceEntries([original]), after = sourceEntries([{ ...original, name: 'after' }]), mongo = memoryMongo(before)
    const saved = [...mongo.bank('talio_records').values()][0]; saved.envelope.data.name = 'external-edit'
    try {
      await expect(applyDelta(args(mongo, before, after, dir))).rejects.toThrow('BEFORE_HASH')
      expect([...mongo.bank('talio_firestore_archive').values()].filter(doc => doc.run === candidateRun)).toHaveLength(0)
      expect(mongo.bank('talio_records').get(saved._id).envelope.data.name).toBe('external-edit')
      expect(mongo.bank('talio_migration_delta_batches').size).toBe(0)
    } finally { await fs.rm(dir, { recursive: true, force: true }) }
  })
  test('rolls back the entire atomic batch on write failure and safely retries using private before-images', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-delta-atomic-'))
    const before = sourceEntries([original]), after = sourceEntries([{ ...original, name: 'after' }]), mongo = memoryMongo(before)
    mongo.control.failBulk = true
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await expect(applyDelta(args(mongo, before, after, dir))).rejects.toThrow('SIMULATED')
      expect([...mongo.bank('talio_records').values()][0].envelope.data.name).toBe('before')
      expect([...mongo.bank('talio_firestore_archive').values()].filter(doc => doc.run === candidateRun)).toHaveLength(0)
      expect(mongo.bank('talio_migration_delta_batches').size).toBe(0)
      expect((await fs.readdir(dir)).some(file => file.endsWith('.bson.gz'))).toBe(true)
      mongo.control.failBulk = false
      expect(await applyDelta(args(mongo, before, after, dir))).toMatchObject({ applied: 1 })
    } finally { log.mockRestore(); await fs.rm(dir, { recursive: true, force: true }) }
  })
  test('fails closed for missing/wrong fence or an already activated catalog', async () => {
    const before = sourceEntries([original]), after = sourceEntries([original])
    const mongo = memoryMongo(before)
    mongo.bank('talio_migration_controls').get('write-fence').candidateRun = 'different-run-123'
    await expect(applyDelta(args(mongo, before, after, '/unused'))).rejects.toThrow('WRITE_FENCE')
    mongo.bank('talio_migration_controls').get('write-fence').candidateRun = candidateRun
    mongo.bank('talio_catalogs').get(dataset).mongoVerified = true
    await expect(applyDelta(args(mongo, before, after, '/unused'))).rejects.toThrow('NON_WRITABLE')
    expect(mongo.control.transactions).toBe(0)
  })
  test('rejects invalid and expired fence times before any target write', async () => {
    const before = sourceEntries([original]), after = sourceEntries([original]), mongo = memoryMongo(before)
    const fence = mongo.bank('talio_migration_controls').get('write-fence')
    for (const expiresAt of ['invalid-date', '2000-01-01T00:00:00Z', null]) {
      fence.expiresAt = expiresAt
      await expect(applyDelta(args(mongo, before, after, '/unused'))).rejects.toThrow('WRITE_FENCE')
    }
    expect(mongo.control.transactions).toBe(0)
    expect(mongo.bank('talio_migration_delta_runs').size).toBe(0)
  })
  test('binds resumability to the exact operation sequence and batching limits', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-delta-layout-'))
    const before = sourceEntries([original]), after = sourceEntries([{ ...original, name: 'after' }]), mongo = memoryMongo(before)
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await applyDelta({ ...args(mongo, before, after, dir), maxWrites: 2 })
      await expect(applyDelta({ ...args(mongo, before, after, dir), maxWrites: 3 })).rejects.toThrow('DELTA_RUN_CONFLICT')
      const changed = sourceEntries([{ ...original, name: 'different' }])
      await expect(applyDelta({ ...args(mongo, before, changed, dir), maxWrites: 2 })).rejects.toThrow('DELTA_RUN_CONFLICT')
    } finally { log.mockRestore(); await fs.rm(dir, { recursive: true, force: true }) }
  })
  test('reconciles claims and catalog fields while preserving non-writable flags', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-delta-control-'))
    const before = sourceEntries([original]), after = sourceEntries([original])
    const claimPath = `talioDatasets/${dataset}/databases/${databaseName}/uniqueKeys/claim-example`
    before.set(claimPath, entry(claimPath, { owner: 'before-owner' }))
    after.set(claimPath, entry(claimPath, { owner: 'after-owner' }))
    const catalogPath = `talioDatasets/${dataset}`
    after.set(catalogPath, entry(catalogPath, { tenants: [{ databaseName }], purpose: 'production', status: 'ready', applicationCutover: true, updated: 'new-catalog-value' }))
    const mongo = memoryMongo(before), log = jest.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await applyDelta(args(mongo, before, after, dir))
      expect([...mongo.bank('talio_unique_keys').values()][0].owner).toBe('after-owner')
      expect(mongo.bank('talio_catalogs').get(dataset)).toMatchObject({ updated: 'new-catalog-value', mongoVerified: false, applicationCutover: false })
      expect(await importMongo(mongo.db, after, { run: candidateRun, collections: [] }, [dataset], true)).toMatchObject({ verified: true, claimCount: 1 })
    } finally { log.mockRestore(); await fs.rm(dir, { recursive: true, force: true }) }
  })
  test('verifies checkpoint after-state before resuming, rejecting edits made after a completed batch', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-delta-checkpoint-'))
    const before = sourceEntries([original]), after = sourceEntries([{ ...original, name: 'after' }]), mongo = memoryMongo(before)
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await applyDelta(args(mongo, before, after, dir))
      ;[...mongo.bank('talio_records').values()][0].envelope.data.name = 'later-edit'
      await expect(applyDelta(args(mongo, before, after, dir))).rejects.toThrow('CHANGED_AFTER')
    } finally { log.mockRestore(); await fs.rm(dir, { recursive: true, force: true }) }
  })
  test('rejects forged shared payload references and tampered immutable baseline bytes', async () => {
    const before = sourceEntries([original]), mongo = memoryMongo(before)
    const operations = buildDeltaOperations(before, before, baselineRun, candidateRun, [dataset])
    const alias = operations.find(operation => operation.document.sharedPayloadFrom).document
    await expect(resolveSharedArchiveDocuments(mongo.db.collection('talio_firestore_archive'), [{ ...alias, sharedPayloadRun: 'wrong-run-123' }])).rejects.toThrow('PAYLOAD_MISMATCH')
  })
  test('enforces count and BSON byte bounds rather than allowing an unbounded transaction', () => {
    const operations = Array.from({ length: 5 }, (_, index) => ({ document: { _id: String(index), content: 'x'.repeat(10) } }))
    expect(boundedBatches(operations, 2).map(batch => batch.length)).toEqual([2, 2, 1])
    expect(() => boundedBatches(operations, 101)).toThrow('BATCH_BOUND')
    expect(() => boundedBatches(operations, 2, 1)).toThrow('DOCUMENT_EXCEEDS')
    const smallReplacements = Array.from({ length: 5 }, (_, index) => ({ document: { _id: String(index) }, beforeBytes: 900 }))
    expect(boundedBatches(smallReplacements, 100, 3000).map(batch => batch.length)).toEqual([2, 2, 1])
  })
})
