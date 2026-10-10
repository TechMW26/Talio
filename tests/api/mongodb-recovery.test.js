const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pack } = require('../../lib/platform/firestoreCodec.cjs')
const { sha256, collectionSummary } = require('../../scripts/mongodb-migration/core.cjs')
const { exportTree, retrySourceRead, loadEntries, readRecoveryBatch } = require('../../scripts/mongodb-migration/migrate.cjs')

test('metadata recovery reuses only exact valid immutable versions and fetches full changed/new/unversioned bodies', async () => {
  const refs = ['unchanged', 'changed', 'new', 'unversioned', 'removed'].map(name => ({ path: `root/${name}` }))
  const fields = pack({ count: { integerValue: '1' } })
  const saved = name => ({ path: `root/${name}`, exists: true, fields, sha256: sha256(JSON.stringify(fields)), updateTime: { seconds: 1, nanoseconds: 123 } })
  const existing = new Map(refs.filter(ref => !ref.path.endsWith('/new')).map(ref => [ref.path, saved(ref.path.split('/')[1])]))
  existing.get('root/unversioned').updateTime = null
  const snapshots = refs.map(ref => ({ ref, exists: !ref.path.endsWith('/removed'), updateTime: { seconds: ref.path.endsWith('/changed') ? 2 : 1, nanoseconds: 123 }, _fieldsProto: {} }))
  const db = { getAll: jest.fn(async (...args) => {
    if (args.at(-1)?.fieldMask) return snapshots
    return args.map(ref => ({ ref, exists: true, updateTime: { seconds: 2, nanoseconds: 123 }, _fieldsProto: { count: { integerValue: '2' } } }))
  }) }
  const result = await readRecoveryBatch(db, refs, existing)
  expect(result).toMatchObject({ reused: 1, fullFetched: 3 })
  expect(result.entries[0]).toBe(existing.get('root/unchanged'))
  expect(result.entries.at(-1)).toMatchObject({ exists: false, fields: null })
  expect(db.getAll.mock.calls[0].at(-1)).toEqual({ fieldMask: [] })
  expect(db.getAll.mock.calls[1].map(ref => ref.path)).toEqual(['root/changed', 'root/new', 'root/unversioned'])
  snapshots[0].updateTime = null
  await readRecoveryBatch(db, refs, existing)
  expect(db.getAll.mock.calls.at(-1).map(ref => ref.path)).toContain('root/unchanged')
})

test('metadata recovery rejects partial/duplicate/misrouted provider results instead of dropping a document', async () => {
  const ref = { path: 'root/document' }
  for (const snapshots of [[], [{ ref }], [{ ref: { path: 'different/document' }, exists: false }], [{ ref, exists: false }, { ref, exists: false }]]) {
    await expect(readRecoveryBatch({ getAll: async () => snapshots }, [ref], new Map())).rejects.toThrow('METADATA_BATCH_IDENTITY')
  }
})

test('indexed metadata recovery retains old bodies, counts removals and discovers new children under unchanged parents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-recovery-topology-'))
  const oldRun = 'mongo-old-topology', newRun = 'mongo-new-topology'
  const oldDir = path.join(root, '.migration-data', oldRun), file = `${sha256('root')}.ndjson`
  const fields = pack({ count: { integerValue: '1' } })
  const oldEntry = name => ({ path: `root/${name}`, exists: true, fields, sha256: sha256(JSON.stringify(fields)), updateTime: { seconds: 1, nanoseconds: 0 } })
  const baseline = [oldEntry('keep'), oldEntry('removed')]
  await fs.mkdir(oldDir, { recursive: true })
  const oldBody = baseline.map(entry => JSON.stringify(entry)).join('\n') + '\n'
  await fs.writeFile(path.join(oldDir, file), oldBody)
  await fs.writeFile(path.join(oldDir, 'manifest.json'), JSON.stringify({ run: oldRun, complete: false, collections: [{ path: 'root', file, summary: collectionSummary(baseline) }] }))
  const ref = documentPath => ({ path: documentPath, listCollections: async () => documentPath === 'root/keep' ? [{ path: 'root/keep/children' }] : [] })
  const db = {
    listCollections: async () => [{ path: 'root' }],
    collection: collectionPath => ({ listDocuments: async () => (collectionPath === 'root' ? ['root/keep', 'root/added'] : ['root/keep/children/new']).map(ref) }),
    getAll: jest.fn(async (...args) => {
      const masked = Boolean(args.at(-1)?.fieldMask)
      const requested = masked ? args.slice(0, -1) : args
      return requested.map(reference => ({ ref: reference, exists: true, updateTime: { seconds: reference.path === 'root/keep' ? 1 : 2, nanoseconds: 0 }, _fieldsProto: masked ? {} : { count: { integerValue: reference.path === 'root/keep' ? '1' : '2' } } })).reverse()
    }),
  }
  const log = jest.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await recoverBaseline(root, oldRun, newRun)
    const dir = path.join(root, '.migration-data', newRun), manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json')))
    const reports = await exportTree(db, dir, manifest, false, { reuseUnchanged: true })
    expect(reports).toHaveLength(2)
    expect(reports[0].summary.documents).toBe(2)
    expect(reports[1].summary.documents).toBe(1)
    const entries = await loadEntries(dir, { collections: reports })
    expect(entries.get('root/keep')).toEqual(baseline[0])
    expect(entries.has('root/removed')).toBe(false)
    expect(entries.has('root/keep/children/new')).toBe(true)
    const fullCalls = db.getAll.mock.calls.filter(args => !args.at(-1)?.fieldMask)
    expect(fullCalls.flat().map(reference => reference.path)).toEqual(['root/added', 'root/keep/children/new'])
    expect(log.mock.calls.map(call => JSON.parse(call[0])).find(report => report.event === 'source-collection-exported' && report.recoveryGeneration)).toMatchObject({ changedDocuments: 1, removedDocuments: 1 })
    expect(await fs.readFile(path.join(oldDir, file), 'utf8')).toBe(oldBody)
    expect(await exportTree(db, dir, manifest, true, { reuseUnchanged: true })).toEqual(reports)
  } finally { log.mockRestore(); await fs.rm(root, { recursive: true, force: true }) }
})
const { recoverBaseline } = require('../../scripts/mongodb-migration/recover-baseline.cjs')
const { IndexedArchive } = require('../../scripts/mongodb-migration/indexed-archive.cjs')

test('seed validator closes indexed readers before hardlinking and refuses corrupted collections', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-recovery-seed-close-'))
  const oldRun = 'mongo-seed-old-123', newRun = 'mongo-seed-new-123', invalidRun = 'mongo-seed-invalid-123'
  const oldDir = path.join(root, '.migration-data', oldRun), file = `${sha256('seed')}.ndjson`
  const fields = pack({ value: { stringValue: 'synthetic' } })
  const entries = ['root/z', 'root/a'].map(documentPath => ({ path: documentPath, exists: true, fields, sha256: sha256(JSON.stringify(fields)), updateTime: null }))
  await fs.mkdir(oldDir, { recursive: true })
  await fs.writeFile(path.join(oldDir, file), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n')
  const manifestBytes = JSON.stringify({ run: oldRun, complete: false, collections: [{ path: 'root', file, summary: collectionSummary(entries) }] })
  await fs.writeFile(path.join(oldDir, 'manifest.json'), manifestBytes)
  const close = jest.spyOn(IndexedArchive.prototype, 'close')
  const originalLink = fs.link
  const link = jest.spyOn(fs, 'link').mockImplementation(async (...args) => {
    expect(close).toHaveBeenCalledTimes(1)
    return originalLink(...args)
  })
  try {
    await recoverBaseline(root, oldRun, newRun)
    expect(close).toHaveBeenCalledTimes(1)
    expect(await fs.readFile(path.join(oldDir, 'manifest.json'), 'utf8')).toBe(manifestBytes)
    link.mockClear(); close.mockClear()
    await fs.writeFile(path.join(oldDir, file), JSON.stringify({ ...entries[0], sha256: 'corrupted' }))
    await expect(recoverBaseline(root, oldRun, invalidRun)).rejects.toThrow('CHECKSUM')
    expect(link).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
    await expect(fs.access(path.join(root, '.migration-data', invalidRun, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { link.mockRestore(); close.mockRestore(); await fs.rm(root, { recursive: true, force: true }) }
})

test('retries only transient reads, bounded, with no provider errors or values in logs', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {})
  const sleep = jest.fn(async () => {}), read = jest.fn().mockRejectedValueOnce(Object.assign(new Error('private provider details'), { code: 4 })).mockResolvedValue('result')
  try {
    expect(await retrySourceRead(read, 'batch-documents', { sleep })).toBe('result')
    expect(read).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    const denied = jest.fn().mockRejectedValue(Object.assign(new Error('denied'), { code: 7 }))
    await expect(retrySourceRead(denied, 'batch-documents', { sleep })).rejects.toThrow('denied')
    expect(denied).toHaveBeenCalledTimes(1)
    const failed = jest.fn().mockRejectedValue(Object.assign(new Error('unavailable'), { code: 14 }))
    await expect(retrySourceRead(failed, 'batch-documents', { sleep, attempts: 3 })).rejects.toThrow('unavailable')
    expect(failed).toHaveBeenCalledTimes(3)
    expect(log.mock.calls.flat().join(' ')).not.toContain('private provider details')
  } finally { log.mockRestore() }
})

test('explicit recovery refreshes changed source while retaining original archives; strict resume still rejects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-recovery-'))
  const oldRun = 'mongo-failed-123', newRun = 'mongo-recovered-123', oldDir = path.join(root, '.migration-data', oldRun), file = `${sha256('root')}.ndjson`
  const fields = pack({ count: { integerValue: '1' } }), original = { path: 'root/document', exists: true, fields, sha256: sha256(JSON.stringify(fields)), updateTime: { seconds: 1, nanoseconds: 0 } }
  await fs.mkdir(oldDir, { recursive: true, mode: 0o700 })
  await fs.writeFile(path.join(oldDir, file), JSON.stringify(original) + '\n', { mode: 0o600 })
  const manifest = { run: oldRun, complete: false, collections: [{ path: 'root', file, summary: collectionSummary([original]) }] }
  const originalManifest = JSON.stringify(manifest)
  await fs.writeFile(path.join(oldDir, 'manifest.json'), originalManifest)
  const ref = { path: 'root/document', listCollections: jest.fn().mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 4 })).mockResolvedValue([]) }
  const db = { listCollections: async () => [{ path: 'root' }], collection: () => ({ listDocuments: async () => [ref] }), getAll: jest.fn(async () => [{ ref, exists: true, _fieldsProto: { count: { integerValue: '2' } }, updateTime: { seconds: 2, nanoseconds: 0 } }]) }
  const log = jest.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await expect(exportTree(db, oldDir, manifest, false, { retryOptions: { sleep: async () => {} } })).rejects.toThrow('SOURCE_CHANGED')
    const report = await recoverBaseline(root, oldRun, newRun)
    expect(report).toMatchObject({ linkedCompletedCollections: 1, previousArchivesRetained: true, complete: false })
    const dir = path.join(root, '.migration-data', newRun), recovered = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json')))
    ref.listCollections.mockReset().mockRejectedValue(Object.assign(new Error('denied during partial crawl'), { code: 7 }))
    await expect(exportTree(db, dir, recovered, false, { retryOptions: { sleep: async () => {} } })).rejects.toThrow('denied during partial crawl')
    expect((await loadEntries(dir, recovered)).get(original.path)).toEqual(original)
    ref.listCollections.mockReset().mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 4 })).mockResolvedValue([])
    const callsBefore = db.getAll.mock.calls.length
    const completed = await exportTree(db, dir, recovered, false, { childConcurrency: 128, batchSize: 256, retryOptions: { sleep: async () => {} } })
    expect(db.getAll.mock.calls.length - callsBefore).toBe(1) // child retry does not reread successful batches
    expect(ref.listCollections).toHaveBeenCalledTimes(2)
    expect((await loadEntries(dir, { collections: completed })).get(original.path).updateTime.seconds).toBe(2)
    expect(await fs.readFile(path.join(oldDir, file), 'utf8')).toBe(JSON.stringify(original) + '\n')
    expect(await fs.readFile(path.join(oldDir, 'manifest.json'), 'utf8')).toBe(originalManifest)
    expect((await fs.readdir(dir)).some(name => name.startsWith(`${file}.preserved-`))).toBe(true)
    expect(completed[0].file).not.toBe(file)
    expect(await exportTree(db, dir, recovered, true, { reuseUnchanged: true })).toEqual(completed)
    expect(db.getAll.mock.calls.at(-1).some(arg => arg.fieldMask)).toBe(false)
    recovered.complete = true
    await expect(exportTree(null, dir, recovered)).rejects.toThrow('COMPLETED_RECOVERY_GENERATION_IS_IMMUTABLE')
    recovered.complete = false; recovered.sourceRecoveryManifestHash = 'b'.repeat(64)
    await expect(exportTree(null, dir, recovered)).rejects.toThrow('RETAINED_RECOVERY_BASELINE_IDENTITY_MISMATCH')
    await expect(recoverBaseline(root, oldRun, newRun)).rejects.toMatchObject({ code: 'EEXIST' })
  } finally { log.mockRestore(); await fs.rm(root, { recursive: true, force: true }) }
})
