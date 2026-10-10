const { createHash } = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { encodeApplicationRecord, pack } = require('../../lib/platform/firestoreCodec.cjs')
const { blobPath, collectMediaPlan, verifyMediaObjects } = require('../../scripts/mongodb-migration/verify-media.cjs')
const { loadIndexedEntries, sourceCollectionsHash } = require('../../scripts/mongodb-migration/migrate.cjs')
const { collectionSummary, sha256 } = require('../../scripts/mongodb-migration/core.cjs')
const dataset = 'live-example', database = 'talio_company_example', id = '123456789012345678901234'
const digest = value => createHash('sha256').update(value).digest('hex')
const payload = Buffer.from('private-image-bytes')
const mutablePath = `tenants/${database}/images/${dataset}/private-file.png`
const backupPath = `migrations/talio-hrms/source-run/media/${Buffer.from(database).toString('base64url')}/${Buffer.from('images').toString('base64url')}/${digest(JSON.stringify({ $oid: id }))}`
const descriptor = pathname => ({ pathname, database, bucket: 'images', provider: 'vercel-blob', access: 'private', length: payload.length, sha256: digest(payload) })
const entry = (path, application) => ({ path, exists: true, application: pack(application) })
function fixture(record, metadata = {}, collection = 'images.files') {
  const encoded = encodeApplicationRecord({ _id: id, ...record })
  const base = `talioDatasets/${dataset}/databases/${database}/collections/${collection}/records/${id}`
  return new Map([[`talioDatasets/${dataset}`, entry(`talioDatasets/${dataset}`, {})], [base, entry(base, { ...encoded.envelope, ...metadata })], ...encoded.parts.map(part => [`${base}/parts/${part.id}`, entry(`${base}/parts/${part.id}`, part.value)])])
}
const read = bytes => async () => ({ statusCode: 200, stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }) })

describe('read-only complete media verification', () => {
  test('indexed media scan matches Map semantics and refuses changed source bodies', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-indexed-media-test-'))
    let indexed
    try {
      const eager = fixture({ length: payload.length, storage: descriptor(mutablePath), binary: payload, nested: [[1, 2]] }, { media: descriptor(backupPath) })
      const fields = pack({}), fieldHash = sha256(JSON.stringify(fields))
      const bodies = [...eager.values()].map(value => ({ ...value, fields, sha256: fieldHash, updateTime: null }))
      const file = `${sha256('media-fixture')}.ndjson`
      await fs.writeFile(path.join(directory, file), bodies.map(value => JSON.stringify(value)).join('\n') + '\n')
      const manifest = { complete: true, collections: [{ path: 'media-fixture', file, summary: collectionSummary(bodies) }] }
      indexed = await loadIndexedEntries(directory, manifest)
      expect(collectMediaPlan(indexed, [dataset])).toEqual(collectMediaPlan(eager, [dataset]))
      await fs.appendFile(path.join(directory, file), '\n')
      expect(() => collectMediaPlan(indexed, [dataset])).toThrow('ARCHIVE_FILE_CHANGED')
    } finally {
      indexed?.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
    expect(() => indexed.get(`talioDatasets/${dataset}`)).toThrow('ARCHIVE_INDEX_CLOSED')
  })
  test('normalizes only private Blob/local file references, never arbitrary external URL reads', () => {
    expect(blobPath(`https://store.private.blob.vercel-storage.com/${mutablePath}`)).toBe(mutablePath)
    expect(blobPath(`/api/files/${encodeURIComponent(mutablePath)}`)).toBe(mutablePath)
    expect(blobPath('https://outside.example/private.png')).toBeNull()
    expect(() => blobPath('tenants/one/../two')).toThrow('INVALID_BLOB_REFERENCE')
  })
  test('requires an existing selected catalog rather than passing empty typo scope', () => {
    expect(() => collectMediaPlan(fixture({}), ['another-example'])).toThrow('CATALOG_MISSING')
  })
  test('deduplicates references, reconstructs overflow binary, and emits no private values', async () => {
    const entries = fixture({ length: payload.length, storage: descriptor(mutablePath), fileUrl: `/api/files/${mutablePath}`, binary: payload, nested: [[1, 2]] })
    const plan = collectMediaPlan(entries, [dataset])
    expect(plan.report).toMatchObject({ recordsScanned: 1, uniqueObjects: 1, requiredObjects: 1, embeddedBinaryRecords: 1, embeddedBinaryBytes: payload.length, descriptorPlanPassed: true })
    const get = jest.fn(read(payload))
    const result = await verifyMediaObjects(plan, { readBlob: get, maximumBytes: 100 })
    expect(result).toMatchObject({ passed: true, fullSourceIntegrityVerified: true, checksumsVerified: 1, lengthsVerified: 1, writes: 0 })
    expect(get).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain(mutablePath)
    expect(JSON.stringify(result)).not.toContain(database)
  })
  test('retains immutable backup but does not require subsequently deleted mutable object', async () => {
    const plan = collectMediaPlan(fixture({ length: payload.length, storage: descriptor(mutablePath) }, { media: descriptor(backupPath), mediaState: 'deleted' }), [dataset])
    expect(plan.report).toMatchObject({ requiredObjects: 1, deletedObjectsNotRequired: 1, immutableObjects: 1, descriptorPlanPassed: true })
    expect(plan.objects[0].pathname).toBe(backupPath)
    const get = jest.fn(read(payload))
    expect(await verifyMediaObjects(plan, { readBlob: get, maximumBytes: 100 })).toMatchObject({ passed: true })
    expect(get.mock.calls[0][0]).toBe(backupPath)
  })
  test('verifies both distinct current and preserved backup when active', () => {
    const plan = collectMediaPlan(fixture({ length: payload.length, storage: descriptor(mutablePath) }, { media: descriptor(backupPath) }), [dataset])
    expect(plan.report).toMatchObject({ requiredObjects: 2, immutableObjects: 1, descriptorPlanPassed: true })
  })
  test('fails wrong tenant ownership and conflicting checksum declarations', () => {
    const plan = collectMediaPlan(fixture({ length: payload.length, storage: descriptor('tenants/another/images/live-example/file'), attachment: { pathname: 'tenants/another/images/live-example/file', sha256: 'b'.repeat(64) } }), [dataset])
    expect(plan.report).toMatchObject({ descriptorPlanPassed: false, conflictingDescriptors: 1 })
    expect(plan.report.invalidReferences).toBeGreaterThan(0)
  })
  test('unchecksummed generic references are availability-only, external media is explicitly unverified', async () => {
    const plan = collectMediaPlan(fixture({ imageUrl: mutablePath, resumeUrl: 'https://outside.example/resume.pdf' }, {}, 'employees'), [dataset])
    expect(plan.report).toMatchObject({ requiredObjects: 1, objectsWithoutSourceChecksum: 1, externalMediaReferencesNotVerified: 1 })
    expect(await verifyMediaObjects(plan, { readBlob: read(payload), maximumBytes: 100 })).toMatchObject({ passed: true, fullSourceIntegrityVerified: false, availabilityOnlyObjects: 1 })
  })
  test.each([
    ['BLOB_CHECKSUM_MISMATCH', Buffer.alloc(payload.length)],
    ['BLOB_LENGTH_MISMATCH', Buffer.from('short')],
  ])('fails corruption: %s', async (code, bytes) => {
    const plan = collectMediaPlan(fixture({ length: payload.length, storage: descriptor(mutablePath) }), [dataset])
    const result = await verifyMediaObjects(plan, { readBlob: read(bytes), maximumBytes: 100 })
    expect(result).toMatchObject({ passed: false, failures: [{ keyHash: digest(mutablePath), code }] })
  })
  test('fails missing objects safely without provider exception values', async () => {
    const plan = collectMediaPlan(fixture({ length: payload.length, storage: descriptor(mutablePath) }), [dataset])
    const result = await verifyMediaObjects(plan, { readBlob: async () => { throw new Error(`secret ${mutablePath}`) }, maximumBytes: 100 })
    expect(result).toMatchObject({ passed: false, failures: [{ keyHash: digest(mutablePath), code: 'BLOB_READ_FAILED' }] })
    expect(JSON.stringify(result)).not.toContain('secret')
  })
  test('retains every sanitized failure beyond the old 100-key preview cap', async () => {
    const objects = Array.from({ length: 127 }, (_, index) => ({ pathname: `tenants/private/${index}`, keyHash: digest(String(index)), sha256: null, length: null }))
    const result = await verifyMediaObjects({ objects, report: { knownRequiredBytes: 0, descriptorPlanPassed: true } }, { maximumBytes: 100, readBlob: async () => { throw new Error('private-provider-secret') } })
    expect(result).toMatchObject({ complete: true, failedObjects: 127, objectsRead: 127, omittedFailureKeys: 0 })
    expect(result.failures).toHaveLength(127)
    expect(result.failures.every(value => Object.keys(value).sort().join(',') === 'code,keyHash' && value.code === 'BLOB_READ_FAILED')).toBe(true)
    expect(new Set(result.failures.map(value => value.keyHash)).size).toBe(127)
    expect(JSON.stringify(result)).not.toContain('private-provider-secret')
    expect(JSON.stringify(result)).not.toContain('tenants/private')
  })
  test('requires explicit bounded reads and marks unknown-size budget stop incomplete', async () => {
    const plan = collectMediaPlan(fixture({ imageUrl: mutablePath }, {}, 'employees'), [dataset])
    await expect(verifyMediaObjects(plan, { readBlob: read(payload) })).rejects.toThrow('BOUNDED')
    const result = await verifyMediaObjects(plan, { readBlob: read(payload), maximumBytes: 2 })
    expect(result).toMatchObject({ passed: false, complete: false, failedObjects: 1 })
  })
  test('refuses known bytes over budget before making any provider call', async () => {
    const plan = collectMediaPlan(fixture({ length: payload.length, storage: descriptor(mutablePath) }), [dataset])
    const get = jest.fn(read(payload))
    await expect(verifyMediaObjects(plan, { readBlob: get, maximumBytes: 2 })).rejects.toThrow('BYTE_BUDGET_EXCEEDED')
    expect(get).not.toHaveBeenCalled()
  })
  test('progress reports only aggregate counters and leaves exact verification unchanged', async () => {
    const plan = collectMediaPlan(fixture({ length: payload.length, storage: descriptor(mutablePath) }), [dataset])
    const onProgress = jest.fn()
    const report = await verifyMediaObjects(plan, { readBlob: read(payload), maximumBytes: 100, onProgress })
    expect(report).toMatchObject({ passed: true, checksumsVerified: 1, lengthsVerified: 1 })
    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress.mock.calls[0][0]).toMatchObject({ objectsPlanned: 1, objectsStarted: 0, objectsCompleted: 0, bytesRead: 0 })
    expect(onProgress.mock.calls[1][0]).toMatchObject({ objectsPlanned: 1, objectsStarted: 1, objectsCompleted: 1, objectsAvailable: 1, failedObjects: 0, bytesRead: payload.length })
    expect(Object.keys(onProgress.mock.calls[1][0]).sort()).toEqual(['bytesRead', 'elapsedMs', 'failedObjects', 'objectsAvailable', 'objectsCompleted', 'objectsPlanned', 'objectsStarted'])
    expect(JSON.stringify(onProgress.mock.calls)).not.toContain(mutablePath)
    expect(JSON.stringify(onProgress.mock.calls)).not.toContain(database)
    await expect(verifyMediaObjects(plan, { readBlob: read(payload), maximumBytes: 100, onProgress: 'invalid' })).rejects.toThrow('BOUNDED_MEDIA_PROGRESS')
  })
})

// Evaluate the real CLI entry point with only its archive/provider IO replaced.
// No protected archive, env file, or live Blob object is touched by these cases.
async function mediaCli({ command = 'plan', changedDuringRead = false, maximumBytes = 100 } = {}) {
  const script = path.resolve(__dirname, '../../scripts/mongodb-migration/verify-media.cjs')
  const entries = fixture({ length: payload.length, storage: descriptor(mutablePath) })
  let changed = false
  entries.assertUnchanged = jest.fn(() => { if (changed) throw new Error('ARCHIVE_FILE_CHANGED') })
  entries.close = jest.fn()
  const manifest = { run: 'mongo-cli-tests', complete: true, collections: [] }
  const get = jest.fn(async () => { if (changedDuringRead) changed = true; return read(payload)() })
  const logger = { log: jest.fn(), error: jest.fn() }
  const cliProcess = { argv: ['node', script, command, manifest.run, `--datasets=${dataset}`, `--max-bytes=${maximumBytes}`], env: { BLOB_READ_WRITE_TOKEN: 'mock-provider-token' }, exitCode: 0 }
  const isolatedModule = { exports: {} }
  const realRequire = require('node:module').createRequire(script)
  const cliRequire = name => {
    if (name === 'node:fs') return { readFileSync: () => Buffer.from(JSON.stringify(manifest)), existsSync: () => false }
    if (name === './migrate.cjs') return { ...realRequire(name), loadIndexedEntries: jest.fn(async () => entries), sourceCollectionsHash }
    if (name === '@vercel/blob') return { get }
    return realRequire(name)
  }
  const source = await fs.readFile(script, 'utf8')
  const sandbox = { module: isolatedModule, require: cliRequire, __dirname: path.dirname(script), process: cliProcess, console: logger, Buffer, URL, AbortSignal }
  vm.runInNewContext(source.replace(/^#![^\n]*\n/, '') + '\nmodule.exports.main = main', sandbox, { filename: script })
  let error
  try { await isolatedModule.exports.main() } catch (caught) { error = caught }
  return { entries, get, logger, cliProcess, error }
}

test.each(['plan', 'verify'])('media CLI closes indexed archive on successful %s exit', async command => {
  const result = await mediaCli({ command })
  expect(result.error).toBeUndefined()
  expect(result.entries.close).toHaveBeenCalledTimes(1)
  expect(JSON.parse(result.logger.log.mock.calls[0][0])).toMatchObject({ command, writes: 0, ...(command === 'verify' ? { passed: true } : {}) })
})

test('media CLI refuses verified report if archive changes during asynchronous Blob reads and closes handles', async () => {
  const result = await mediaCli({ command: 'verify', changedDuringRead: true })
  expect(result.get).toHaveBeenCalledTimes(1)
  expect(result.error?.message).toBe('ARCHIVE_FILE_CHANGED')
  expect(result.logger.log).not.toHaveBeenCalled()
  expect(result.entries.close).toHaveBeenCalledTimes(1)
})

test('media CLI closes indexed archive when bounded provider verification rejects', async () => {
  const result = await mediaCli({ command: 'verify', maximumBytes: 2 })
  expect(result.error?.message).toBe('MEDIA_VERIFICATION_BYTE_BUDGET_EXCEEDED')
  expect(result.get).not.toHaveBeenCalled()
  expect(result.logger.log).not.toHaveBeenCalled()
  expect(result.entries.close).toHaveBeenCalledTimes(1)
})
