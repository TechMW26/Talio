const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { pack, encodeApplicationRecord } = require('../../lib/platform/firestoreCodec.cjs')
const { sha256, canonical } = require('../../scripts/mongodb-migration/core.cjs')
const { exportTree, loadEntries } = require('../../scripts/mongodb-migration/migrate.cjs')
const { compareEntries, targetDeltaPlan, reconcileArchive } = require('../../scripts/mongodb-migration/reconcile.cjs')

const makeEntry = (documentPath, data, time = 1) => ({ path: documentPath, exists: true, fields: pack(data), application: pack(data), sha256: sha256(JSON.stringify(pack(data))), updateTime: { seconds: time, nanoseconds: 0 } })
const recordPath = 'talioDatasets/live-example/databases/talio_company_example/collections/users/records/123456789012345678901234'
const recordEntries = record => {
  const encoded = encodeApplicationRecord(record)
  return new Map([[recordPath, makeEntry(recordPath, encoded.envelope)], ...encoded.parts.map(part => [`${recordPath}/parts/${part.id}`, makeEntry(`${recordPath}/parts/${part.id}`, part.value)])])
}

describe('read-only final source reconciliation', () => {
  test('journals additions, updates, removals and timestamp-only writes without embedding bodies', () => {
    const before = new Map([['a/removed', makeEntry('a/removed', { private: 'old-secret' })], ['a/updated', makeEntry('a/updated', { number: 1 })], ['a/time', makeEntry('a/time', { number: 2 })], ['a/same', makeEntry('a/same', { number: 3 })]])
    const after = new Map([['a/added', makeEntry('a/added', { private: 'new-secret' })], ['a/updated', makeEntry('a/updated', { number: 9 })], ['a/time', makeEntry('a/time', { number: 2 }, 2)], ['a/same', makeEntry('a/same', { number: 3 })]])
    const result = compareEntries(before, after)
    expect(result.totals).toEqual({ added: 1, updated: 2, removed: 1, metadataOnly: 1, unchanged: 1 })
    expect(JSON.stringify(result)).not.toContain('old-secret')
    expect(JSON.stringify(result)).not.toContain('new-secret')
    expect(result.changes.find(change => change.path === 'a/time')).toMatchObject({ action: 'updated', metadataOnly: true })
  })
  test('includes an owning record replacement when its embedded overflow part changes', () => {
    const before = recordEntries({ _id: '123456789012345678901234', nested: [[1, 2]] })
    const after = recordEntries({ _id: '123456789012345678901234', nested: [[3, 4]] })
    const plan = targetDeltaPlan(before, after, ['live-example'])
    expect(plan.totals).toEqual({ insert: 0, replace: 1, removeFromLiveBank: 0, unchanged: 0 })
    expect(plan.operations[0]).toMatchObject({ bank: 'talio_records', action: 'replace' })
    expect(plan).toMatchObject({ targetWritesPerformed: false, requiresOptimisticBeforeHashCheck: true, requiresFrozenSourceAndNoTargetWriters: true })
  })
  test('retains deleted records in baseline while planning removal only from live application bank', () => {
    const before = recordEntries({ _id: '123456789012345678901234', name: 'former' })
    const plan = targetDeltaPlan(before, new Map(), ['live-example'])
    expect(plan.totals.removeFromLiveBank).toBe(1)
    expect(before.size).toBe(1)
    expect(plan.operations[0].action).toBe('removeFromLiveBank')
    expect(plan.operations[0].beforeHash).toMatch(/^[a-f0-9]{64}$/)
    expect(plan.operations[0].afterHash).toBeNull()
  })
  test('does not plan redundant Mongo writes for timestamp-only source changes', () => {
    const before = recordEntries({ _id: '123456789012345678901234', name: 'unchanged' })
    const after = new Map([...before].map(([key, value]) => [key, { ...value, updateTime: { seconds: 9, nanoseconds: 0 } }]))
    expect(compareEntries(before, after).totals.metadataOnly).toBe(1)
    expect(targetDeltaPlan(before, after, ['live-example']).totals).toEqual({ insert: 0, replace: 0, removeFromLiveBank: 0, unchanged: 1 })
  })
  test('creates complete new candidate without rewriting baseline and refuses to claim stable cutover', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-reconcile-'))
    const baselineRun = 'mongo-baseline-123', candidateRun = 'mongo-candidate-123'
    const baselineDir = path.join(root, '.migration-data', baselineRun)
    await fs.mkdir(baselineDir, { recursive: true })
    let state = new Map([['root/a', { name: 'old' }], ['root/b', { name: 'deleted' }]])
    const ref = documentPath => ({ path: documentPath, listCollections: async () => [] })
    const db = { listCollections: async () => [{ path: 'root' }], collection: collectionPath => ({ listDocuments: async () => [...state.keys()].filter(key => key.startsWith(`${collectionPath}/`)).map(ref) }), getAll: async (...refs) => refs.map(reference => ({ ref: reference, exists: true, _fieldsProto: { name: { stringValue: state.get(reference.path).name } }, data: () => state.get(reference.path), updateTime: { seconds: 1, nanoseconds: 0 } })) }
    const baseline = { version: 1, run: baselineRun, sourceProject: 'test-project', sourceDatabase: '(default)', selectedDataset: 'live-example', complete: false, collections: [] }
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    try {
      baseline.collections = await exportTree(db, baselineDir, baseline)
      baseline.complete = true
      const manifestBytes = JSON.stringify(baseline)
      await fs.writeFile(path.join(baselineDir, 'manifest.json'), manifestBytes)
      const oldEntries = await loadEntries(baselineDir, baseline)
      state = new Map([['root/a', { name: 'updated' }], ['root/c', { name: 'added' }]])
      const report = await reconcileArchive({ db, root, baselineRun, candidateRun, datasets: ['live-example'] })
      expect(report.totals).toMatchObject({ added: 1, updated: 1, removed: 1 })
      expect(report).toMatchObject({ completeCurrentStateScan: true, stableSourceVerified: false, cutoverSafe: false, historicalTransientMutationsRecoverable: false, targetWritesPerformed: false })
      expect(await fs.readFile(path.join(baselineDir, 'manifest.json'), 'utf8')).toBe(manifestBytes)
      expect(canonical([...(await loadEntries(baselineDir, baseline))])).toBe(canonical([...oldEntries]))
      const candidateDir = path.join(root, '.migration-data', candidateRun)
      const candidate = JSON.parse(await fs.readFile(path.join(candidateDir, 'manifest.json'), 'utf8'))
      expect(candidate).toMatchObject({ complete: true, cutoverSafe: false, sourceVerificationRequired: true })
      const current = await loadEntries(candidateDir, candidate)
      expect(current.has('root/b')).toBe(false)
      expect(oldEntries.has('root/b')).toBe(true)
      expect(log.mock.calls.map(call => call[0]).join('\n')).not.toContain('root/a')
      await expect(reconcileArchive({ db, root, baselineRun, candidateRun, datasets: ['live-example'] })).rejects.toThrow('IMMUTABLE')
    } finally { log.mockRestore(); await fs.rm(root, { recursive: true, force: true }) }
  })
  test('refuses same run or incomplete baseline before source access', async () => {
    await expect(reconcileArchive({ db: null, root: '/unused', baselineRun: 'same-run-123', candidateRun: 'same-run-123', datasets: ['live-example'] })).rejects.toThrow('DISTINCT')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-incomplete-reconcile-'))
    try {
      const dir = path.join(root, '.migration-data', 'mongo-baseline-123')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ run: 'mongo-baseline-123', complete: false, collections: [] }))
      await expect(reconcileArchive({ db: null, root, baselineRun: 'mongo-baseline-123', candidateRun: 'mongo-candidate-123', datasets: ['live-example'] })).rejects.toThrow('COMPLETE_BASELINE')
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
})
