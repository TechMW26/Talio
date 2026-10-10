const { PassThrough } = require('node:stream')
const { timestamp, compareTimestamp, compareDocumentNames, metadataRequest, readMetadataPage, ancestorPrefixes } = require('../../scripts/mongodb-migration/fixed-epoch-metadata.cjs')

const sourceProject = 'talio-hrms', sourceDatabase = '(default)'
const parent = `projects/${sourceProject}/databases/${sourceDatabase}/documents`
const now = () => 1791643696032
const readTime = { seconds: '1791643696', nanos: 31528000 }
const options = { sourceProject, sourceDatabase, readTime, now, limit: 3 }
const name = path => `${parent}/${path}`
const response = (path = 'synthetic/one') => ({ readTime, document: { name: name(path), fields: {}, updateTime: { seconds: '1791643600', nanos: 1 }, createTime: { seconds: '1791643500', nanos: 0 } } })
function driver(responses, { hang = false, error } = {}) {
  const stream = new PassThrough({ objectMode: true }), calls = []
  stream.cancel = jest.fn(() => {})
  const client = { runQuery(request, callOptions) {
    calls.push({ request, callOptions })
    process.nextTick(() => { responses.forEach(value => stream.write(value)); if (error) stream.emit('error', error); else if (!hang) stream.end() })
    return stream
  } }
  return { client, calls, stream }
}

test('canonical timestamps preserve nanos and normalize protobuf Long seconds', () => {
  expect(timestamp({ seconds: 1791643696, nanos: 31528000 })).toEqual(readTime)
  expect(timestamp({ seconds: { low: 1791643696, high: 0, toString: () => '1791643696' }, nanoseconds: 31528000 })).toEqual(readTime)
  expect(compareTimestamp(readTime, { ...readTime, nanos: 31528001 })).toBe(-1)
  for (const value of [{ seconds: '01791643696' }, { seconds: 1.5 }, { seconds: '1', nanos: -1 }, { seconds: '1', nanos: 1e9 }, { seconds: '1', nanos: 1, nanoseconds: 2 }]) expect(() => timestamp(value)).toThrow('EXACT_PROTOBUF_TIMESTAMP_REQUIRED')
})

test('request selects all descendants with no collection ID at one fixed epoch, bounded and resume exclusive', () => {
  const request = metadataRequest({ ...options, afterName: name('synthetic/one') })
  expect(request).toEqual({ parent, readTime, structuredQuery: { from: [{ allDescendants: true }], select: { fields: [{ fieldPath: '__name__' }] }, orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: { value: 3 }, startAt: { values: [{ referenceValue: name('synthetic/one') }], before: false } } })
  for (const invalid of [{ limit: 0 }, { limit: 5001 }, { afterName: 'foreign/document' }, { readTime: { ...readTime, nanos: 1 } }, { sourceProject: '../foreign' }]) expect(() => metadataRequest({ ...options, ...invalid })).toThrow()
})

test('capped page returns nested metadata only; exact-limit page is not EOF; empty page is terminal', async () => {
  const value = driver([response('a/one'), response('a/one/sub/two'), response('z/three')])
  const page = await readMetadataPage(value.client, options)
  expect(page).toMatchObject({ protocol: 'fixed-epoch-kindless-metadata-v1', rows: [{ path: 'a/one' }, { path: 'a/one/sub/two' }, { path: 'z/three' }], done: false, afterName: name('z/three'), fullBodiesRead: false, cutoverSafe: false, sourceWrites: 0 })
  expect(value.calls).toHaveLength(1)
  expect(value.calls[0].callOptions).toMatchObject({ timeout: 30000, retry: null })
  const empty = driver([{ readTime }])
  expect(await readMetadataPage(empty.client, { ...options, afterName: page.afterName })).toMatchObject({ rows: [], done: true, afterName: page.afterName })
})

test.each(['body', 'missing-version', 'duplicate', 'out-of-order', 'foreign', 'older-epoch', 'future-update', 'create-after-update', 'skip', 'too-many', 'resumed-cursor'])('rejects unsafe page (%s) and cancels transport', async kind => {
  let rows = [response()], params = options
  if (kind === 'body') rows[0].document.fields = { privateBody: {} }
  if (kind === 'missing-version') delete rows[0].document.updateTime
  if (kind === 'duplicate') rows.push(response())
  if (kind === 'out-of-order') rows = [response('z/one'), response('a/two')]
  if (kind === 'foreign') rows[0].document.name = rows[0].document.name.replace(sourceProject, 'foreign-project')
  if (kind === 'older-epoch') rows[0].readTime = { ...readTime, nanos: 31527000 }
  if (kind === 'future-update') rows[0].document.updateTime = { ...readTime, nanos: 31529000 }
  if (kind === 'create-after-update') rows[0].document.createTime = readTime
  if (kind === 'skip') rows[0].skippedResults = 1
  if (kind === 'too-many') rows = ['a', 'b', 'c', 'd'].map(item => response(`synthetic/${item}`))
  if (kind === 'resumed-cursor') params = { ...options, afterName: name('synthetic/one') }
  const value = driver(rows)
  await expect(readMetadataPage(value.client, params)).rejects.toThrow()
  expect(value.stream.cancel).toHaveBeenCalledTimes(1)
})

test('empty-response flood is bounded, and stream consumption deadline cancels a hang', async () => {
  const noProof = driver([])
  await expect(readMetadataPage(noProof.client, options)).rejects.toThrow('EXACT_METADATA_PAGE_RESPONSE_REQUIRED')
  const flood = driver(Array.from({ length: 6 }, () => ({ readTime })))
  await expect(readMetadataPage(flood.client, options)).rejects.toThrow('EXACT_METADATA_PAGE_EPOCH_REQUIRED')
  const hanging = driver([response()], { hang: true })
  await expect(readMetadataPage(hanging.client, { ...options, deadlineMs: 10 })).rejects.toThrow('BOUNDED_METADATA_STREAM_TIMEOUT')
  expect(hanging.stream.cancel).toHaveBeenCalledTimes(1)
})

test('operator abort applies to stream consumption and pre-aborted scans make no RPC', async () => {
  const already = new AbortController(); already.abort()
  const inactive = driver([])
  await expect(readMetadataPage(inactive.client, { ...options, signal: already.signal })).rejects.toThrow('SOURCE_METADATA_QUERY_ABORTED')
  expect(inactive.calls).toHaveLength(0)
  const active = new AbortController(), hanging = driver([response()], { hang: true })
  const pending = readMetadataPage(hanging.client, { ...options, signal: active.signal })
  active.abort()
  await expect(pending).rejects.toThrow('SOURCE_METADATA_QUERY_ABORTED')
  expect(hanging.stream.cancel).toHaveBeenCalledTimes(1)
})

test('rejects expired epochs before transport and during consumption; does not expose provider secret strings', async () => {
  const expired = driver([])
  await expect(readMetadataPage(expired.client, { ...options, now: () => now() + 3601000 })).rejects.toThrow('FIXED_SOURCE_EPOCH_EXPIRED_OR_FUTURE')
  expect(expired.calls).toHaveLength(0)
  let ticks = 0
  const rolling = driver([response()])
  await expect(readMetadataPage(rolling.client, { ...options, now: () => (++ticks >= 3 ? now() + 3601000 : now()) })).rejects.toThrow('FIXED_SOURCE_EPOCH_EXPIRED_OR_FUTURE')
  const failed = driver([], { error: Object.assign(new Error('SENSITIVE_PROVIDER_PAYLOAD'), { code: 14 }) })
  await expect(readMetadataPage(failed.client, options)).rejects.toMatchObject({ message: 'SOURCE_METADATA_QUERY_FAILED', code: 14 })
})

test('derives unknown collection topology and candidate missing ancestors from names without recursive child RPCs', () => {
  expect(ancestorPrefixes(name('newRoots/missingParent/unknownBank/existing/deeper/leaf'), options)).toEqual({ collections: ['newRoots', 'newRoots/missingParent/unknownBank', 'newRoots/missingParent/unknownBank/existing/deeper'], possibleMissingParents: ['newRoots/missingParent', 'newRoots/missingParent/unknownBank/existing'] })
})

test('document names follow SDK path-segment UTF8 order, including hyphenated prefix IDs and Unicode', async () => {
  // Joined bytes order the hyphen BEFORE the slash; Firestore compares the
  // shorter segment first, then its descendants before the sibling a-.
  const paths = ['synthetic/a/child/leaf', 'synthetic/a-/child/leaf', 'synthetic/é', 'synthetic/中', 'synthetic/😀']
  expect(Buffer.compare(Buffer.from(name(paths[0])), Buffer.from(name(paths[1])))).toBeGreaterThan(0)
  expect(compareDocumentNames(name(paths[0]), name(paths[1]))).toBeLessThan(0)
  const value = driver(paths.map(path => response(path)))
  expect((await readMetadataPage(value.client, { ...options, limit: paths.length })).rows.map(row => row.path)).toEqual(paths)
})

test('numeric Firestore __idN__ document segments compare numerically, precede strings, and do not truncate large values', async () => {
  const paths = ['synthetic/__id-2__', 'synthetic/__id2__', 'synthetic/__id10__', 'synthetic/__id9007199254740993__', 'synthetic/0', 'synthetic/A']
  expect(compareDocumentNames(name(paths[1]), name(paths[2]))).toBeLessThan(0)
  expect(compareDocumentNames(name('synthetic/__id9007199254740993__'), name('synthetic/__id9007199254740994__'))).toBeLessThan(0)
  const value = driver(paths.map(path => response(path)))
  expect((await readMetadataPage(value.client, { ...options, limit: paths.length })).rows.map(row => row.path)).toEqual(paths)
  const reversed = driver([response(paths[2]), response(paths[1])])
  await expect(readMetadataPage(reversed.client, options)).rejects.toThrow('METADATA_PAGE_ORDER_PROJECTION_OR_VERSION_INVALID')
})

test('cross-page cursor uses the same segment/numeric order and rejects replays', async () => {
  const first = driver([response('synthetic/a/child/leaf')])
  const page = await readMetadataPage(first.client, { ...options, limit: 1 })
  const next = driver([response('synthetic/a-/child/leaf')])
  expect((await readMetadataPage(next.client, { ...options, limit: 1, afterName: page.afterName })).rows[0].path).toBe('synthetic/a-/child/leaf')
  const numeric = driver([response('synthetic/__id10__')])
  await expect(readMetadataPage(numeric.client, { ...options, afterName: name('synthetic/__id2__') })).resolves.toMatchObject({ rows: [{ path: 'synthetic/__id10__' }] })
  const replay = driver([response('synthetic/a/child/leaf')])
  await expect(readMetadataPage(replay.client, { ...options, afterName: page.afterName })).rejects.toThrow('METADATA_PAGE_ORDER_PROJECTION_OR_VERSION_INVALID')
})
