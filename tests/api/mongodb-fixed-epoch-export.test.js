const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { snapshotEntry, collectionSummary, sha256 } = require('../../scripts/mongodb-migration/core.cjs')
const { loadIndexedEntries } = require('../../scripts/mongodb-migration/indexed-archive.cjs')
const { PROTOCOL, reusable, exportFixedEpochArchive } = require('../../scripts/mongodb-migration/fixed-epoch-export.cjs')
const { verifyFixedEpochCandidate, PROTOCOL: VERIFICATION_PROTOCOL } = require('../../scripts/mongodb-migration/fixed-epoch-verification.cjs')
const { verifiedSourceEpoch, sourceTreeCounts } = require('../../scripts/mongodb-migration/migrate.cjs')
const { compareDocumentNames } = require('../../scripts/mongodb-migration/fixed-epoch-metadata.cjs')

const sourceProject = 'talio-test', sourceDatabase = '(default)'
const parent = `projects/${sourceProject}/databases/${sourceDatabase}/documents`
const readTime = { seconds: '1800000000', nanos: 0 }, now = () => 1800000001000
const version = seconds => ({ seconds: String(seconds), nanos: 123000 })
const doc = (name, update = 1799999999, value = name) => ({ name: `${parent}/${name}`, fields: { value: { stringValue: value } }, createTime: version(1799999990), updateTime: version(update) })
const snapshot = value => ({ exists: true, ref: { path: value.name.slice(parent.length + 1) }, _fieldsProto: value.fields, updateTime: { seconds: Number(value.updateTime.seconds), nanoseconds: value.updateTime.nanos }, data: () => ({ value: value.fields.value.stringValue }) })
function stream(responses) {
  const result = new EventEmitter(); result.cancel = jest.fn()
  queueMicrotask(() => { for (const response of responses) result.emit('data', response); result.emit('end') })
  return result
}
function transport(documents, tweak = value => value) {
  return {
    runQuery: jest.fn(request => {
      const after = request.structuredQuery.startAt?.values[0].referenceValue
      const rows = [...documents].sort((left, right) => compareDocumentNames(left.name, right.name)).filter(value => !after || compareDocumentNames(value.name, after) > 0).slice(0, request.structuredQuery.limit.value)
      return stream(rows.length ? rows.map(value => ({ readTime, document: { ...value, fields: {} } })) : [{ readTime }])
    }),
    batchGetDocuments: jest.fn(request => stream(request.documents.map(name => tweak({ readTime, found: documents.find(value => value.name === name) })))),
  }
}

describe('fixed epoch metadata plus audited exact-version body export', () => {
  let temporary
  beforeEach(() => { temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'talio-fixed-epoch-'))) })
  afterEach(() => { fs.rmSync(temporary, { recursive: true, force: true }) })
  function setup(baselineDocs = []) {
    const baselineDirectory = path.join(temporary, 'baseline'); fs.mkdirSync(baselineDirectory, { mode: 0o700 })
    const groups = new Map()
    for (const value of baselineDocs) {
      const entry = snapshotEntry(snapshot(value)), name = entry.path.slice(0, entry.path.lastIndexOf('/'))
      if (!groups.has(name)) groups.set(name, [])
      groups.get(name).push(entry)
    }
    const collections = [...groups].map(([name, entries]) => {
      const file = `${sha256(name)}.ndjson`; fs.writeFileSync(path.join(baselineDirectory, file), entries.map(entry => JSON.stringify(entry) + '\n').join(''), { mode: 0o600 })
      return { path: name, file, summary: collectionSummary(entries) }
    })
    const baseline = { run: 'baseline-example', sourceProject, sourceDatabase, complete: true, collections }
    const bytes = JSON.stringify(baseline); fs.writeFileSync(path.join(baselineDirectory, 'manifest.json'), bytes, { mode: 0o600 })
    return { directory: path.join(temporary, 'candidate-example'), run: 'candidate-example', baselineDirectory, baselineManifestHash: sha256(bytes), sourceProject, sourceDatabase, readTime, now, snapshotFromDocument: snapshot }
  }
  test('reuses unchanged audited bodies but freshly reads changed and new versions at one epoch', async () => {
    const before = [doc('users/a'), doc('users/b')], current = [before[0], doc('users/b', 1800000000 - 1, 'changed')]
    current[1].updateTime = { seconds: '1799999999', nanos: 456000 }
    current.push(doc('users/c'))
    const options = setup(before), client = transport(current)
    const result = await exportFixedEpochArchive({ ...options, client, pageSize: 2, batchSize: 1 })
    expect(result).toMatchObject({ consistency: PROTOCOL, complete: true, reusedDocuments: 1, fullDocumentsFetched: 2, fullBodiesRead: false, noReuse: false, cutoverSafe: false, applicationCutover: false, sourceWrites: 0, targetWrites: 0 })
    expect(client.batchGetDocuments.mock.calls.flatMap(([request]) => request.documents)).toEqual([current[1].name, current[2].name])
    for (const [request] of client.batchGetDocuments.mock.calls) expect(request.readTime).toEqual(readTime)
    const archive = await loadIndexedEntries(options.directory, result)
    expect(archive.size).toBe(3)
    expect(archive.get('users/a')).toEqual(snapshotEntry(snapshot(before[0])))
    expect(archive.get('users/a').createTime).toBeUndefined()
    expect(archive.get('users/c').createTime).toEqual({ seconds: '1799999990', nanoseconds: 123000 }); archive.close()
    expect(fs.statSync(options.directory).mode & 0o777).toBe(0o700)
    for (const filename of fs.readdirSync(options.directory)) expect(fs.statSync(path.join(options.directory, filename)).mode & 0o777).toBe(0o600)
  })
  test('derives missing ancestors and every collection, removes deleted baseline entries, and proves exact-limit EOF', async () => {
    const options = setup([doc('removed/old')]), current = [doc('root/absent/children/one'), doc('root/present')]
    const client = transport(current), result = await exportFixedEpochArchive({ ...options, client, pageSize: 1 })
    expect(client.runQuery).toHaveBeenCalledTimes(3)
    expect(result.metadataEvidence.pages.at(-1)).toMatchObject({ rows: 0, done: true })
    expect(result.missingParents).toBe(1)
    expect(result.collections.map(value => value.path)).toEqual(['root', 'root/absent/children'])
    const archive = await loadIndexedEntries(options.directory, result)
    expect(archive.get('root/absent').exists).toBe(false); expect(archive.has('removed/old')).toBe(false); archive.close()
  })
  test('does not mark an existing ancestor missing and preserves unknown nested namespaces', async () => {
    const current = [doc('root/yes'), doc('root/yes/unknown/child/deeper/value')]
    const options = setup(), result = await exportFixedEpochArchive({ ...options, client: transport(current) })
    expect(result.missingParents).toBe(1)
    expect(result.collections).toHaveLength(3)
  })
  test('exports hyphen-prefix siblings and numeric names across page boundaries using actual Firestore order', async () => {
    const current = [doc('root/a/children/value'), doc('root/a-/children/value'), doc('root/__id10__'), doc('root/__id2__')]
    const options = setup(), client = transport(current)
    const result = await exportFixedEpochArchive({ ...options, client, pageSize: 1 })
    expect(result.metadataDocuments).toBe(4)
    expect(result.missingParents).toBe(2)
    expect(result.metadataEvidence.terminalPageObserved).toBe(true)
    expect(client.runQuery).toHaveBeenCalledTimes(5)
    const archive = await loadIndexedEntries(options.directory, result)
    expect(archive.size).toBe(6)
    for (const item of current) expect(archive.get(item.name.slice(parent.length + 1)).exists).toBe(true)
    archive.close()
  })
  test.each([
    ['wrong read epoch', response => ({ ...response, readTime: version(1799999998) })],
    ['missing body', response => ({ readTime, missing: response.found.name })],
    ['wrong update version', response => ({ ...response, found: { ...response.found, updateTime: version(1799999998) } })],
  ])('rejects %s without a complete manifest', async (_, tweak) => {
    const options = setup()
    await expect(exportFixedEpochArchive({ ...options, client: transport([doc('users/a')], tweak) })).rejects.toThrow('EXACT_BODY')
    expect(JSON.parse(fs.readFileSync(path.join(options.directory, 'manifest.json'))).complete).toBe(false)
  })
  test('rejects corrupt baseline before any provider read', async () => {
    const options = setup([doc('users/a')]), client = transport([doc('users/a')])
    const filename = fs.readdirSync(options.baselineDirectory).find(name => name.endsWith('.ndjson'))
    fs.appendFileSync(path.join(options.baselineDirectory, filename), 'bad\n')
    await expect(exportFixedEpochArchive({ ...options, client })).rejects.toThrow()
    expect(client.runQuery).not.toHaveBeenCalled(); expect(fs.existsSync(options.directory)).toBe(false)
  })
  test('rejects symlink archives and preexisting candidate directories', async () => {
    const options = setup([doc('users/a')]), client = transport([])
    fs.mkdirSync(options.directory)
    await expect(exportFixedEpochArchive({ ...options, client })).rejects.toThrow()
    expect(client.runQuery).not.toHaveBeenCalled()
    fs.rmdirSync(options.directory)
    const filename = fs.readdirSync(options.baselineDirectory).find(name => name.endsWith('.ndjson'))
    fs.renameSync(path.join(options.baselineDirectory, filename), path.join(temporary, 'body'))
    fs.symlinkSync(path.join(temporary, 'body'), path.join(options.baselineDirectory, filename))
    await expect(exportFixedEpochArchive({ ...options, client })).rejects.toThrow('REAL_ARCHIVE_FILE')
  })
  test('requires matching createTime when baseline has it, allows missing legacy createTime only with exact updateTime', () => {
    const value = doc('users/a'), entry = snapshotEntry(snapshot(value)), metadata = { path: 'users/a', ...value }
    expect(reusable(entry, metadata)).toBe(true)
    expect(reusable({ ...entry, createTime: version(1799999989) }, metadata)).toBe(false)
    expect(reusable({ ...entry, updateTime: null }, metadata)).toBe(false)
  })
  test('rejects a dishonest body decoder', async () => {
    const options = setup()
    await expect(exportFixedEpochArchive({ ...options, client: transport([doc('users/a')]), snapshotFromDocument: value => snapshot({ ...value, fields: { value: { stringValue: 'wrong' } } }) })).rejects.toThrow('DECODED_BODY')
  })
  test('binds the baseline manifest hash and source scope before provider reads', async () => {
    const options = setup(), client = transport([])
    await expect(exportFixedEpochArchive({ ...options, client, baselineManifestHash: '0'.repeat(64) })).rejects.toThrow('BASELINE_MANIFEST_HASH')
    await expect(exportFixedEpochArchive({ ...options, client, sourceProject: 'other-project' })).rejects.toThrow('SOURCE_SCOPE_CHANGED')
    expect(client.runQuery).not.toHaveBeenCalled()
  })
  test('rejects baseline mutation during export and leaves an incomplete candidate', async () => {
    const options = setup([doc('users/a')])
    const filename = fs.readdirSync(options.baselineDirectory).find(name => name.endsWith('.ndjson'))
    await expect(exportFixedEpochArchive({ ...options, client: transport([doc('users/a')]), onProgress: () => fs.appendFileSync(path.join(options.baselineDirectory, filename), '\n') })).rejects.toThrow('ARCHIVE_FILE_CHANGED')
    expect(JSON.parse(fs.readFileSync(path.join(options.directory, 'manifest.json'))).complete).toBe(false)
  })
  test('rejects duplicate body responses and missing body stream entries', async () => {
    const options = setup(), value = doc('users/a'), client = transport([value])
    client.batchGetDocuments.mockImplementation(() => stream([{ readTime, found: value }, { readTime, found: value }]))
    await expect(exportFixedEpochArchive({ ...options, client })).rejects.toThrow('EXACT_BODY')
    const second = { ...options, run: 'candidate-second', directory: path.join(temporary, 'candidate-second') }
    client.batchGetDocuments.mockImplementation(() => stream([]))
    await expect(exportFixedEpochArchive({ ...second, client })).rejects.toThrow('INCOMPLETE_BODY_BATCH')
  })
  test('rejects group-readable baseline files without provider access', async () => {
    const options = setup([doc('users/a')]), client = transport([])
    const filename = fs.readdirSync(options.baselineDirectory).find(name => name.endsWith('.ndjson'))
    fs.chmodSync(path.join(options.baselineDirectory, filename), 0o640)
    await expect(exportFixedEpochArchive({ ...options, client })).rejects.toThrow('REAL_ARCHIVE_FILE')
    expect(client.runQuery).not.toHaveBeenCalled()
  })
  test('requires a distinct run even when the output directory is separate', async () => {
    const options = setup(), client = transport([])
    await expect(exportFixedEpochArchive({ ...options, client, run: 'baseline-example', directory: path.join(temporary, 'baseline-example') })).rejects.toThrow('SEPARATE_CANDIDATE_RUN')
    expect(client.runQuery).not.toHaveBeenCalled()
  })
  const finalOptions = () => ({ targetBaselineRun: 'target-before-example', targetBaselineManifestHash: 'b'.repeat(64), datasets: ['live-example'], writersDrainedAt: new Date(now() - 3000).toISOString(), writerDrainEvidenceHash: 'd'.repeat(64) })
  test('independently verifies final same-epoch metadata, changed bodies and audited reused bodies with distinct target provenance', async () => {
    const options = setup([doc('users/a')]), current = [doc('users/a'), doc('users/b')], client = transport(current)
    const candidate = await exportFixedEpochArchive({ ...options, client, finalOptions: finalOptions() })
    const candidateManifestHash = sha256(fs.readFileSync(path.join(options.directory, 'manifest.json')))
    const source = await verifyFixedEpochCandidate({ ...options, client, candidateManifestHash })
    expect(client.runQuery).toHaveBeenCalledTimes(2)
    expect(client.batchGetDocuments).toHaveBeenCalledTimes(2)
    expect(source).toMatchObject({ verificationProtocol: VERIFICATION_PROTOCOL, reusedDocuments: 1, changedBodiesVerified: 1, fullBodiesRead: false, noReuse: false, baselineRun: 'baseline-example', sourceBaselineRun: 'target-before-example', cutoverSafe: false })
    const expected = { ...source, candidateStartedAt: candidate.startedAt, candidateExportFinishedAt: candidate.exportFinishedAt, sourceCounts: sourceTreeCounts(candidate.collections), fixedEpochCandidate: candidate }
    expect(verifiedSourceEpoch(source, expected, now())).toMatchObject({ mode: VERIFICATION_PROTOCOL, startedAt: new Date(Number(readTime.seconds) * 1000).toISOString(), readTime })
    for (const change of [
      value => { value.fullBodiesRead = true }, value => { value.noReuse = true },
      value => { value.metadataHash = 'a'.repeat(64) }, value => { value.reusedBodiesVerified = 0 },
      value => { value.writerDrainEvidenceHash = 'e'.repeat(64) }, value => { value.readTime = version(1799999999) },
      value => { value.changedBodiesIndependentlyRead = false },
    ]) { const changed = structuredClone(source); change(changed); expect(() => verifiedSourceEpoch(changed, expected, now())).toThrow('BOUND_FIXED_EPOCH') }
    expect(() => verifiedSourceEpoch({ complete: true }, expected, now())).toThrow('BOUND_FIXED_EPOCH')
  })
  test('online exports cannot be retroactively verified as final snapshots', async () => {
    const options = setup(), client = transport([doc('users/a')])
    await exportFixedEpochArchive({ ...options, client })
    const candidateManifestHash = sha256(fs.readFileSync(path.join(options.directory, 'manifest.json')))
    await expect(verifyFixedEpochCandidate({ ...options, client, candidateManifestHash })).rejects.toThrow('EXPLICIT_FINAL')
    expect(client.runQuery).toHaveBeenCalledTimes(1)
  })
  test('rejects final epochs older than the declared drain before any provider reads', async () => {
    const options = setup(), client = transport([])
    await expect(exportFixedEpochArchive({ ...options, client, finalOptions: { ...finalOptions(), writersDrainedAt: new Date(now()).toISOString() } })).rejects.toThrow('FRESH_POST_DRAIN')
    expect(client.runQuery).not.toHaveBeenCalled()
  })
  test('independent metadata reread rejects missing current documents', async () => {
    const options = setup(), client = transport([doc('users/a')])
    await exportFixedEpochArchive({ ...options, client, finalOptions: finalOptions() })
    const candidateManifestHash = sha256(fs.readFileSync(path.join(options.directory, 'manifest.json')))
    await expect(verifyFixedEpochCandidate({ ...options, client: transport([]), candidateManifestHash })).rejects.toThrow('UNEXPECTED_ARCHIVE_ENTRY')
    expect(fs.existsSync(path.join(options.directory, 'source-verification.json'))).toBe(false)
  })
})
