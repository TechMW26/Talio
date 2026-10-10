const { encodeApplicationRecord, pack, unpack, recordDigest } = require('../../lib/platform/firestoreCodec.cjs')
const { sha256, snapshotEntry, archiveDocument, decodeArchiveDocument, materializeRecord, materializeCatalog, materializeClaim, assertTarget, collectionSummary, assertSameSource, mongoRecordId } = require('../../scripts/mongodb-migration/core.cjs')
const { exportTree, importMongo, planMongo } = require('../../scripts/mongodb-migration/migrate.cjs')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const proto = { count: { integerValue: '9007199254740993' }, reference: { referenceValue: 'projects/example/databases/(default)/documents/a/b' }, geo: { geoPointValue: { latitude: 1.25, longitude: 2.5 } }, bytes: { bytesValue: Buffer.from([0, 255]) }, date: { timestampValue: { seconds: '123', nanos: 123456789 } } }
const entry = (name, value, fields = proto) => ({ path: name, exists: true, fields: pack(fields), sha256: sha256(JSON.stringify(pack(fields))), updateTime: { seconds: 123, nanoseconds: 456 }, ...(value ? { application: pack(value) } : {}) })
const base = 'talioDatasets/live-example/databases/talio_company_example/collections/users/records/123456789012345678901234'

describe('lossless, explicitly scoped Mongo migration', () => {
  test('preserves raw Firestore integer precision, timestamp nanos, references, geography and bytes', () => {
    const input = entry('any/document')
    const document = archiveDocument(input, 'mongo-run-123')
    const actual = decodeArchiveDocument(document)
    expect(actual).toEqual(input)
    expect(unpack(actual.fields)).toEqual(proto)
    expect(document.bytes.length).toBeGreaterThan(0)
  })
  test('normalizes proto Long values without rounding and preserves exceptional doubles and empty nested types', () => {
    const long = { __isLong__: true, toString: () => '-9223372036854775808' }
    const fields = { low: { integerValue: long }, high: { integerValue: '9223372036854775807' }, negativeZero: { doubleValue: -0 }, infinite: { doubleValue: Infinity }, notNumber: { doubleValue: NaN }, nested: { mapValue: { fields: { empty: { arrayValue: { values: [] } }, nothing: { nullValue: 'NULL_VALUE' }, bytes: { bytesValue: new Uint8Array([0, 128, 255]) } } } } }
    const source = snapshotEntry({ exists: true, _fieldsProto: fields, ref: { path: 'synthetic/document' }, updateTime: { seconds: 1, nanoseconds: 999999999 } })
    const restored = unpack(decodeArchiveDocument(archiveDocument(source, 'mongo-run-123')).fields)
    expect(restored.low.integerValue).toBe('-9223372036854775808')
    expect(restored.high.integerValue).toBe('9223372036854775807')
    expect(Object.is(restored.negativeZero.doubleValue, -0)).toBe(true)
    expect(restored.infinite.doubleValue).toBe(Infinity)
    expect(Number.isNaN(restored.notNumber.doubleValue)).toBe(true)
    expect(restored.nested.mapValue.fields.bytes.bytesValue).toEqual(Buffer.from([0, 128, 255]))
    expect(restored.nested.mapValue.fields.empty.arrayValue.values).toEqual([])
  })
  test('archives nonexistent parents without losing traversal identity', () => {
    const snapshot = { exists: false, ref: { path: 'missing/parent' }, data: () => undefined }
    const value = snapshotEntry(snapshot)
    expect(decodeArchiveDocument(archiveDocument(value, 'mongo-run-123'))).toEqual(value)
    expect(collectionSummary([value])).toMatchObject({ documents: 0, missingParents: 1 })
  })
  test('rejects corrupt archives and unsafe paths', () => {
    expect(() => archiveDocument({ ...entry('a/b'), sha256: 'wrong' }, 'mongo-run-123')).toThrow('CHECKSUM')
    expect(() => archiveDocument(entry('a/../b/c'), 'mongo-run-123')).toThrow('PATH')
    const document = archiveDocument(entry('a/b'), 'mongo-run-123')
    expect(() => decodeArchiveDocument({ ...document, payloadSha256: 'wrong' })).toThrow('CHECKSUM')
  })
  test('materializes one shared Mongo record with checked overflow parts and media backup marker', () => {
    const record = { _id: '123456789012345678901234', password: 'already-hashed-value', nested: [[1, new Date('2026-01-01')]], bytes: Buffer.from([1, 2, 3]) }
    const encoded = encodeApplicationRecord(record)
    const envelope = { ...encoded.envelope, media: { pathname: 'preserved-backup', sha256: 'known' }, mediaState: 'deleted' }
    const parent = entry(base, envelope)
    const entries = new Map([[base, parent], ...encoded.parts.map(part => [`${base}/parts/${part.id}`, entry(`${base}/parts/${part.id}`, part.value)])])
    const result = materializeRecord(parent, entries, 'live-example')
    expect(result.digest).toBe(recordDigest(record))
    expect(result.envelope.media).toEqual(envelope.media)
    expect(result.envelope.mediaState).toBe('deleted')
    expect(result.parts).toEqual(encoded.parts)
    expect(result._id).toBe(mongoRecordId('live-example', 'talio_company_example', 'users', record._id))
  })
  test('fails on missing or tampered application parts rather than skipping any data', () => {
    const encoded = encodeApplicationRecord({ _id: '123456789012345678901234', deep: [[1, 2]] })
    const parent = entry(base, encoded.envelope)
    expect(() => materializeRecord(parent, new Map(), 'live-example')).toThrow('PART_MISSING')
    const parts = new Map(encoded.parts.map(part => [`${base}/parts/${part.id}`, entry(`${base}/parts/${part.id}`, { bytes: Buffer.from('broken') })]))
    expect(() => materializeRecord(parent, parts, 'live-example')).toThrow()
  })
  test('does not materialize inactive archive datasets or unrelated root documents', () => {
    expect(materializeRecord(entry('legacy/document', {}), new Map(), 'live-example')).toBeNull()
    const encoded = encodeApplicationRecord({ _id: '123456789012345678901234' })
    expect(materializeRecord(entry(base, encoded.envelope), new Map(), 'another-dataset')).toBeNull()
  })
  test('requires an exact explicit target host and application database allowlist', () => {
    const uri = 'mongodb+srv://user:private@cluster.example.test/talio'
    expect(assertTarget(uri, 'talio', 'cluster.example.test', 'talio')).toEqual({ host: 'cluster.example.test', databaseName: 'talio' })
    expect(() => assertTarget(uri, 'talio', 'another.example.test', 'talio')).toThrow('NOT_EXPLICITLY_ALLOWED')
    expect(() => assertTarget(uri, 'admin', 'cluster.example.test', 'admin')).toThrow('NOT_EXPLICITLY_ALLOWED')
    expect(() => assertTarget(uri, 'talio', undefined, undefined)).toThrow('NOT_EXPLICITLY_ALLOWED')
  })
  test('detects value changes, deletions and same-value update timestamp changes', () => {
    const before = entry('a/b')
    expect(() => assertSameSource(before, { ...before, exists: false })).toThrow('SOURCE_CHANGED')
    expect(() => assertSameSource(before, { ...before, sha256: 'new' })).toThrow('SOURCE_CHANGED')
    expect(() => assertSameSource(before, { ...before, updateTime: { seconds: 123, nanoseconds: 457 } })).toThrow('SOURCE_CHANGED')
    expect(() => assertSameSource(before, { ...before })).not.toThrow()
  })
  test('collection manifests are order-independent and cover application projections too', () => {
    const a = entry('a/b', { data: 'one' }), b = entry('a/c', { data: 'two' })
    expect(collectionSummary([a, b])).toEqual(collectionSummary([b, a]))
    expect(collectionSummary([a])).not.toEqual(collectionSummary([{ ...a, application: pack({ data: 'changed' }) }]))
  })
  test('catalog and uniqueness claims keep scope while cutover remains gated', () => {
    const catalog = materializeCatalog(entry('talioDatasets/live-example', { tenants: [{ databaseName: 'talio_company_example' }], applicationCutover: true, purpose: 'production', status: 'ready' }))
    expect(catalog).toMatchObject({ _id: 'live-example', applicationCutover: false, mongoVerified: false, sourceApplicationCutover: true })
    const claim = materializeClaim(entry('talioDatasets/live-example/databases/talio_company_example/uniqueKeys/claim-id', { owner: 'users/123456789012345678901234' }), 'live-example')
    expect(claim._id).toBe(sha256(JSON.stringify(['live-example', 'talio_company_example', 'claim-id'])))
    expect(claim).toMatchObject({ dataset: 'live-example', databaseName: 'talio_company_example' })
  })
  test('sizes every raw archive, active record and catalog before an Atlas import', () => {
    const encoded = encodeApplicationRecord({ _id: '123456789012345678901234', name: 'person' })
    const entries = new Map([[base, entry(base, encoded.envelope)], ['talioDatasets/live-example', entry('talioDatasets/live-example', { tenants: [] })]])
    const plan = planMongo(entries, { run: 'mongo-run-123' }, ['live-example'])
    expect(plan).toMatchObject({ rawCount: 2, recordCount: 1, catalogCount: 1, fitsFreeTierWithHeadroom: true })
    expect(plan.archiveBytes).toBeGreaterThan(0)
    expect(plan.applicationBytes).toBeGreaterThan(0)
    expect(plan.conservativeStorageBytes).toBeGreaterThan(plan.payloadBytes)
  })
  test('imports idempotently without deletion then independently detects mutated Mongo data', async () => {
    const banks = new Map()
    const matches = (doc, filter) => Object.entries(filter).every(([field, value]) => value && typeof value === 'object' && '$in' in value ? value.$in.includes(doc[field]) : doc[field] === value)
    const db = { collection(name) {
      if (!banks.has(name)) banks.set(name, new Map())
      const bank = banks.get(name)
      async function updateOne(filter, update, options = {}) {
        const saved = [...bank.values()].find(doc => matches(doc, filter))
        if (saved) Object.assign(saved, update.$set || {})
        else if (options.upsert) bank.set(filter._id, { ...filter, ...update.$setOnInsert, ...update.$set })
      }
      return {
        createIndex: async () => 'index', updateOne,
        findOne: async filter => [...bank.values()].find(doc => matches(doc, filter)) || null,
        find: filter => ({ toArray: async () => [...bank.values()].filter(doc => matches(doc, filter)) }),
        countDocuments: async filter => [...bank.values()].filter(doc => matches(doc, filter)).length,
        bulkWrite: async operations => { for (const operation of operations) await updateOne(operation.updateOne.filter, operation.updateOne.update, { upsert: operation.updateOne.upsert }) },
      }
    } }
    const encoded = encodeApplicationRecord({ _id: '123456789012345678901234', name: 'person', nested: [[1, 2]] })
    const entries = new Map([[base, entry(base, encoded.envelope)], ['talioDatasets/live-example', entry('talioDatasets/live-example', { tenants: [] })], ...encoded.parts.map(part => [`${base}/parts/${part.id}`, entry(`${base}/parts/${part.id}`, part.value)])])
    const manifest = { run: 'mongo-run-123', collections: [] }
    const onProgress = jest.fn()
    expect(await importMongo(db, entries, manifest, 'live-example', false, { onProgress })).toMatchObject({ rawCount: 3, recordCount: 1, verified: false, cutoverSafe: false })
    expect(onProgress).toHaveBeenCalledWith({ rawCount: 3, recordCount: 1, claimCount: 0, catalogCount: 1, archiveEntries: 3, elapsedSeconds: expect.any(Number) })
    expect(JSON.stringify(onProgress.mock.calls)).not.toContain(base)
    await importMongo(db, entries, manifest, 'live-example')
    expect(banks.get('talio_records').size).toBe(1)
    expect(await importMongo(db, entries, manifest, 'live-example', true)).toMatchObject({ verified: true, cutoverSafe: false })
    const saved = [...banks.get('talio_records').values()][0]
    const originalRecord = pack(saved)
    const recordMutations = [
      actual => actual.parts.push({ id: 'unreferenced-part', value: { bytes: Buffer.from('extra') } }),
      actual => actual.parts.push(actual.parts[0]),
      actual => { actual.recordKey = 'changed-route-key' },
      actual => { actual.collectionName = 'changed-logical-bank' },
    ]
    for (const mutate of recordMutations) {
      const actual = unpack(originalRecord); mutate(actual)
      banks.get('talio_records').set(saved._id, actual)
      await expect(importMongo(db, entries, manifest, 'live-example', true)).rejects.toThrow(/MONGO_APPLICATION_(?:PART|RECORD)_MISMATCH/)
    }
    banks.get('talio_records').set(saved._id, unpack(originalRecord))
    const rawId = sha256(JSON.stringify([manifest.run, base]))
    const originalRaw = pack(banks.get('talio_firestore_archive').get(rawId))
    for (const field of ['path', 'run', 'sha256', 'exists']) {
      const altered = unpack(originalRaw)
      altered[field] = field === 'exists' ? !altered[field] : 'altered-ledger-identity'
      banks.get('talio_firestore_archive').set(rawId, altered)
      await expect(importMongo(db, entries, manifest, 'live-example', true)).rejects.toThrow('ARCHIVE_IDENTITY_OR_PAYLOAD')
    }
    const alteredEntry = { ...entries.get(base), application: pack({ ...encoded.envelope, additionalProjection: 'unexpected' }) }
    banks.get('talio_firestore_archive').set(rawId, archiveDocument(alteredEntry, manifest.run))
    await expect(importMongo(db, entries, manifest, 'live-example', true)).rejects.toThrow('ARCHIVE_IDENTITY_OR_PAYLOAD')
    banks.get('talio_firestore_archive').set(rawId, unpack(originalRaw))
    // Extra valid documents outside the expected ID list still fail totals.
    const extras = [
      ['talio_firestore_archive', archiveDocument(entry('extra/document'), manifest.run)],
      ['talio_records', { ...unpack(originalRecord), _id: 'extra-record' }],
      ['talio_unique_keys', { _id: 'extra-claim', dataset: 'live-example', databaseName: 'talio_company_example', owner: 'users/example' }],
      ['talio_catalogs', { _id: 'extra-catalog' }],
    ]
    for (const [bank, extra] of extras) {
      banks.get(bank).set(extra._id, extra)
      await expect(importMongo(db, entries, manifest, 'live-example', true)).rejects.toThrow('TOTAL_COUNT_MISMATCH')
      banks.get(bank).delete(extra._id)
    }
    expect(await importMongo(db, entries, manifest, 'live-example', true)).toMatchObject({ verified: true })
    banks.get('talio_records').set(saved._id, saved)
    saved.envelope.data.name = 'changed'
    await expect(importMongo(db, entries, manifest, 'live-example', true)).rejects.toThrow('RECORD_MISMATCH')
  })
  test('walks subcollections of missing parents, resumes, and verifies the complete tree', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-mongo-migration-'))
    const refs = {
      'root/absent': { path: 'root/absent', listCollections: async () => [{ path: 'root/absent/children' }] },
      'root/absent/children/child': { path: 'root/absent/children/child', listCollections: async () => [] },
    }
    const db = {
      listCollections: async () => [{ path: 'root' }],
      collection: name => ({ listDocuments: async () => name === 'root' ? [refs['root/absent']] : [refs['root/absent/children/child']] }),
      getAll: async (...batch) => batch.map(ref => ({ ref, exists: ref.path.endsWith('/child'), _fieldsProto: proto, data: () => ({}), updateTime: undefined })),
    }
    const manifest = { collections: [] }
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const partial = `${sha256('root')}.ndjson.tmp`
      await fs.writeFile(path.join(dir, partial), 'protected-interrupted-export')
      const reports = await exportTree(db, dir, manifest)
      expect(reports).toHaveLength(2)
      expect(reports[0].summary.missingParents).toBe(1)
      expect(reports[1].summary.documents).toBe(1)
      const preserved = (await fs.readdir(dir)).find(name => name.startsWith(`${partial}.preserved-`))
      expect(await fs.readFile(path.join(dir, preserved), 'utf8')).toBe('protected-interrupted-export')
      expect(log.mock.calls.map(call => call[0]).join('\n')).not.toContain('root/absent')
      expect(await exportTree(db, dir, manifest, true)).toEqual(reports)
      expect(await exportTree(db, dir, manifest)).toEqual(reports)
    } finally { log.mockRestore(); await fs.rm(dir, { recursive: true, force: true }) }
  })
  test('rejects invalid traversal concurrency before reading any source', async () => {
    await expect(exportTree(null, '/unused', {}, false, { childConcurrency: 129 })).rejects.toThrow('CONCURRENCY')
    await expect(exportTree(null, '/unused', {}, false, { childConcurrency: 0 })).rejects.toThrow('CONCURRENCY')
    await expect(exportTree(null, '/unused', {}, false, { batchSize: 257 })).rejects.toThrow('BATCH_SIZE')
  })
  test('orders every provider batch explicitly and hashes the same canonical sorted collection', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-source-order-'))
    const refs = ['root/z', 'root/a', 'root/missing'].map(documentPath => ({ path: documentPath, listCollections: async () => [] }))
    const snapshot = ref => ({ ref, exists: !ref.path.endsWith('/missing'), _fieldsProto: proto, updateTime: { seconds: 1, nanoseconds: 42 } })
    const db = { listCollections: async () => [{ path: 'root' }], collection: () => ({ listDocuments: async () => [...refs] }), getAll: async (...batch) => batch.map(snapshot).reverse() }
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const manifest = { collections: [] }
      const reports = await exportTree(db, dir, manifest, false, { batchSize: 2 })
      expect(reports[0].summary).toEqual(collectionSummary(refs.map(ref => snapshotEntry(snapshot(ref)))))
      const saved = (await fs.readFile(path.join(dir, reports[0].file), 'utf8')).trim().split('\n').map(line => JSON.parse(line).path)
      expect(saved).toEqual(['root/a', 'root/missing', 'root/z'])
      expect(await exportTree(db, dir, manifest, true, { batchSize: 2 })).toEqual(reports)
    } finally { log.mockRestore(); await fs.rm(dir, { recursive: true, force: true }) }
  })
  test('rejects incomplete, duplicate, wrong-path and malformed full source snapshots without checkpointing', async () => {
    const ref = { path: 'root/document', listCollections: async () => [] }
    const valid = { ref, exists: true, _fieldsProto: proto, updateTime: null }
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    try {
      for (const snapshots of [[], [valid, valid], [{ ...valid, ref: { path: 'root/elsewhere' } }], [{ ...valid, exists: undefined }], null]) {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-source-identity-'))
        const manifest = { collections: [] }
        const db = { listCollections: async () => [{ path: 'root' }], collection: () => ({ listDocuments: async () => [ref] }), getAll: async () => snapshots }
        try {
          await expect(exportTree(db, dir, manifest)).rejects.toThrow('FULL_BATCH_IDENTITY')
          expect(manifest.collections).toEqual([])
          expect((await fs.readdir(dir)).filter(file => file.endsWith('.ndjson'))).toEqual([])
        } finally { await fs.rm(dir, { recursive: true, force: true }) }
      }
    } finally { log.mockRestore() }
  })
  test('rejects duplicate or misrouted collection references before reading document bodies', async () => {
    const ref = { path: 'root/document' }
    for (const refs of [[ref, ref], [{ path: 'different/document' }], [{ path: 'root/a/child/b' }]]) {
      const getAll = jest.fn(), db = { listCollections: async () => [{ path: 'root' }], collection: () => ({ listDocuments: async () => refs }), getAll }
      await expect(exportTree(db, '/unused', { collections: [] })).rejects.toThrow('COLLECTION_REFERENCE_IDENTITY')
      expect(getAll).not.toHaveBeenCalled()
    }
  })
})
