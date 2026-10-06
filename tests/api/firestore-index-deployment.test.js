const { INDEX_URL, IAM_URL, PARENT, validateManifest, planIndexes, requestWithRetry, listIndexes, run, parseArgs, providerFailure } = require('../../scripts/firestore-migration/deploy-indexes.cjs')
const index = field => ({ collectionGroup: 'records', queryScope: 'COLLECTION', fields: [{ fieldPath: `data.${field}`, order: 'ASCENDING' }, { fieldPath: '__name__', order: 'ASCENDING' }] })
const manifest = { indexes: [index('one'), index('two')] }
const current = (field, state = 'READY') => ({ ...index(field), name: `${PARENT}/indexes/${field}`, state })
const permissions = create => ({ data: { permissions: ['datastore.indexes.list', ...(create ? ['datastore.indexes.create'] : [])] } })
const httpError = status => Object.assign(new Error('unsafe provider payload must not be printed'), { response: { status } })

test('provider diagnostics retain safe administrative reasons but never credentials or request configuration', () => {
  const error = { response: { status: 403, data: { error: { status: 'PERMISSION_DENIED', message: 'Permission datastore.indexes.create denied on target project.', details: [{ reason: 'IAM_PERMISSION_DENIED', metadata: { sensitive: 'must-not-print' } }] } } }, config: { headers: { Authorization: 'Bearer must-not-print' } } }
  expect(providerFailure(error)).toEqual({ status: 403, providerStatus: 'PERMISSION_DENIED', message: 'Permission datastore.indexes.create denied on target project.', reasons: ['IAM_PERMISSION_DENIED'] })
  for (const message of ['Authorization: Bearer secret', 'private_key=secret', 'access_token:secret', `Failed: ${'A'.repeat(150)}`, 'token=secret']) {
    expect(providerFailure({ response: { status: 403, data: { error: { message } } } }).message).toBe('[redacted provider message]')
  }
  expect(JSON.stringify(providerFailure(error))).not.toContain('must-not-print')
  expect(providerFailure(new Error('secret'))).toEqual({ status: null })
})

test('CLI is read-only by default and rejects unknown/mixed modes', () => {
  expect(parseArgs([])).toEqual({ apply: false, check: false, concurrency: 2 })
  expect(parseArgs(['--check', '--concurrency=4'])).toEqual({ apply: false, check: true, concurrency: 4 })
  expect(() => parseArgs(['--apply', '--check'])).toThrow('mutually exclusive')
  expect(() => parseArgs(['--project=other'])).toThrow('Usage')
  expect(() => parseArgs(['--concurrency=99'])).toThrow('Usage')
})
test('manifest validation enforces fixed scope, field directions and no duplicates', () => {
  expect(validateManifest(manifest)).toHaveLength(2)
  expect(() => validateManifest({ indexes: [{ ...index('one'), collectionGroup: 'other' }] })).toThrow('records')
  expect(() => validateManifest({ indexes: [index('one'), index('one')] })).toThrow('Duplicate manifest')
  expect(() => validateManifest({ indexes: [{ ...index('one'), fields: [{ fieldPath: 'data.one', order: 'SIDEWAYS' }, { fieldPath: '__name__', order: 'ASCENDING' }] }] })).toThrow('Unsupported')
  expect(() => validateManifest({ indexes: [{ ...index('one'), fields: [{ fieldPath: 'data.one', order: 'ASCENDING' }, { fieldPath: '__name__', order: 'DESCENDING' }] }] })).toThrow('ascending')
})
test('exact shape planning preserves unrelated, creating and failed indexes without recreating them', () => {
  const desired = validateManifest(manifest)
  const result = planIndexes(desired, [current('one', 'CREATING'), current('two', 'NEEDS_REPAIR'), current('unrelated')])
  expect(result.missing).toEqual([])
  expect(result.summary).toMatchObject({ existing: 3, ready: 0, creating: 1, needsRepair: 1, complete: false })
  expect(planIndexes(desired, [current('one'), current('two')]).summary.complete).toBe(true)
  expect(planIndexes(desired, [{ ...current('one'), fields: [...current('one').fields].reverse() }]).missing).toHaveLength(2)
})
test('dry run succeeds without create permission and performs no index POST', async () => {
  const request = jest.fn(async options => options.url === IAM_URL ? permissions(false) : { data: { indexes: [] } })
  const result = await run({ request, manifest })
  expect(result).toMatchObject({ missing: 2, ready: 0, complete: false })
  expect(request.mock.calls.filter(([call]) => call.url === INDEX_URL).every(([call]) => call.method === 'GET')).toBe(true)
})
test('apply is blocked before any create without current permission', async () => {
  const request = jest.fn(async options => options.url === IAM_URL ? permissions(false) : { data: { indexes: [] } })
  await expect(run({ request, manifest, apply: true })).rejects.toMatchObject({ status: 403, safeMessage: expect.stringContaining('no indexes changed') })
  expect(request.mock.calls.some(([call]) => call.url === INDEX_URL && call.method === 'POST')).toBe(false)
})
test('list follows every page and prevents a repeated-token infinite loop', async () => {
  const request = jest.fn().mockResolvedValueOnce({ data: { indexes: [current('one')], nextPageToken: 'page-2' } }).mockResolvedValueOnce({ data: { indexes: [current('two')] } })
  expect(await listIndexes(request)).toHaveLength(2)
  expect(request.mock.calls[1][0].params.pageToken).toBe('page-2')
  const loop = jest.fn(async () => ({ data: { nextPageToken: 'repeat' } }))
  await expect(listIndexes(loop)).rejects.toThrow('repeated a token')
})
test('429/503 retries are bounded and permanent errors are never retried', async () => {
  const sleep = jest.fn(async () => {})
  const request = jest.fn().mockRejectedValueOnce(httpError(429)).mockRejectedValueOnce(httpError(503)).mockResolvedValue({ data: {} })
  await requestWithRetry(request, { method: 'GET', url: INDEX_URL }, { sleep })
  expect(sleep.mock.calls.map(call => call[0])).toEqual([1000, 2000])
  const forbidden = jest.fn().mockRejectedValue(httpError(403))
  await expect(requestWithRetry(forbidden, {}, { sleep })).rejects.toMatchObject({ response: { status: 403 } })
  expect(forbidden).toHaveBeenCalledTimes(1)
  const unavailable = jest.fn().mockRejectedValue(httpError(503))
  await expect(requestWithRetry(unavailable, {}, { sleep })).rejects.toMatchObject({ response: { status: 503 } })
  expect(unavailable).toHaveBeenCalledTimes(5)
})
test('apply only creates missing shapes and reports readiness separately from acceptance', async () => {
  const rows = [current('one'), current('unrelated')], calls = []
  const request = async options => {
    calls.push(options)
    if (options.url === IAM_URL) return permissions(true)
    if (options.method === 'GET') return { data: { indexes: [...rows] } }
    rows.push({ ...options.data, state: 'CREATING' })
    return { data: { name: 'operation' } }
  }
  const result = await run({ request, manifest, apply: true })
  expect(result).toMatchObject({ accepted: 1, ready: 1, creating: 1, missing: 0, complete: false })
  expect(calls.filter(call => call.url === INDEX_URL && call.method === 'POST').map(call => call.data)).toEqual([validateManifest(manifest)[1]])
  expect(calls.some(call => ['DELETE', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
})
test('already-exists race is reconciled through the exact final listing', async () => {
  let listing = 0
  const request = async options => {
    if (options.url === IAM_URL) return permissions(true)
    if (options.method === 'GET') return { data: { indexes: listing++ ? [current('one'), current('two')] : [current('one')] } }
    throw httpError(409)
  }
  expect(await run({ request, manifest, apply: true })).toMatchObject({ conflicts: 1, accepted: 0, complete: true })
})
test('concurrent creates stay bounded and permanent failure stops new work', async () => {
  let active = 0, maximum = 0
  const rows = [], events = []
  const request = async options => {
    if (options.url === IAM_URL) return permissions(true)
    if (options.method === 'GET') return { data: { indexes: rows } }
    active++; maximum = Math.max(maximum, active)
    await new Promise(resolve => setImmediate(resolve))
    active--; rows.push({ ...options.data, state: 'READY' })
    return { data: { name: 'operation' } }
  }
  await run({ request, manifest: { indexes: Array.from({ length: 6 }, (_, i) => index(`field${i}`)) }, apply: true, concurrency: 2 })
  expect(maximum).toBe(2)
  const bad = jest.fn(async options => {
    if (options.url === IAM_URL) return permissions(true)
    if (options.method === 'GET') return { data: { indexes: [] } }
    throw httpError(400)
  })
  await expect(run({ request: bad, manifest, apply: true, concurrency: 1, report: value => events.push(value) })).rejects.toMatchObject({ safeMessage: expect.stringContaining('prior accepted indexes are preserved') })
  expect(bad.mock.calls.filter(([call]) => call.url === INDEX_URL && call.method === 'POST')).toHaveLength(1)
  expect(JSON.stringify(events)).not.toContain('unsafe provider payload')
})
