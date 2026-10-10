const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { PROJECT, TEAM, OWNER, validateConfig, scopeHash, archiveRecord, verifyRecord, createArchiveStore, runArchive, boundedTransport, validateClaims, guardedQueueFetch, parseArguments, readToken, main } = require('../../scripts/mongodb-migration/archive-queues.cjs')

const run = 'bc54c120-d65f-4c91-9d73-a35ed29d20b2'
const config = overrides => ({ projectId: PROJECT, teamId: TEAM, owner: OWNER, environment: 'production', region: 'bom1', topic: 'talio-background', run, consumerGroup: `talio-migration-archive-${run}`, deploymentId: null, maxMessages: 2, maxBytes: 1024, maxDurationSeconds: 5, maxMessageBytes: 1024, pollIntervalMs: 1000, outputDirectory: `/private/tmp/queue-synthetic/${run}`, producerPauseObservedAt: '2026-10-10T00:00:00Z', ...overrides })
const metadata = overrides => ({ messageId: 'opaque/message:one', deliveryCount: 1, createdAt: new Date('2026-10-10T00:00:00Z'), expiresAt: new Date('2026-10-11T00:00:00Z'), topicName: 'talio-background', consumerGroup: config().consumerGroup, region: 'bom1', ...overrides })
const durable = record => ({ key: record.key, bytes: record.payload.bytes, sha256: record.payload.sha256 })

describe('independent archival consumer (never dispatches business jobs)', () => {
  test.each([
    { projectId: 'foreign' }, { teamId: 'foreign' }, { environment: 'development' }, { owner: 'foreign' }, { topic: 'other' }, { region: 'fake1' },
    { consumerGroup: 'talio-background-consumer' }, { deploymentId: 'dpl_old' }, { run: '../unsafe' }, { maxMessages: 0 }, { maxBytes: -1 }, { maxDurationSeconds: 3601 }, { maxMessageBytes: 1025 }, { pollIntervalMs: 999 }, { outputDirectory: '/tmp' }, { producerPauseObservedAt: 'invalid' },
  ])('rejects unsafe scope/bounds %j before receive', overrides => {
    expect(() => validateConfig(config(overrides))).toThrow('QUEUE_ARCHIVE_')
  })

  test('exact opaque/unknown payload bytes survive without parsing, with missing original metadata explicit', () => {
    const bytes = Buffer.from([0, 255, 32, 10, 1])
    const record = archiveRecord(bytes, metadata(), validateConfig(config()))
    expect(Buffer.from(record.payload.data, 'base64')).toEqual(bytes)
    expect(record.metadata).toMatchObject({ originalDeploymentId: null, originalDelaySeconds: null, originalVisibleAt: null, originalContentType: null, expiresAtAuthoritative: false })
    expect(record).toMatchObject({ completeness: false, dispatch: 'never' })
    expect(JSON.stringify(record)).not.toMatch(/receiptHandle|token/)
    expect(verifyRecord(record, record)).toBe(record)
    expect(() => verifyRecord({ ...record, metadata: { ...record.metadata, originalDeploymentId: 'invented' } }, record)).toThrow('RECORD_MISMATCH')
  })

  test('bounded raw transport caps buffering without parsing or transforming unknown versions', async () => {
    const { BufferTransport } = require('@vercel/queue')
    const stream = data => new ReadableStream({ start(controller) { for (const bytes of data) controller.enqueue(bytes); controller.close() } })
    await expect(boundedTransport(BufferTransport, 3).deserialize(stream([Buffer.from([0, 255]), Buffer.from([1])]))).resolves.toEqual(Buffer.from([0, 255, 1]))
    await expect(boundedTransport(BufferTransport, 3).deserialize(stream([Buffer.from([0, 255]), Buffer.from([1, 2])]))).rejects.toThrow('BYTES_BOUND')
  })

  test.each([{ region: 'iad1' }, { topicName: 'talio-webhooks' }, { consumerGroup: 'old-group' }, { createdAt: new Date('invalid') }, { deliveryCount: 0 }])('fails closed on wrong delivered metadata %j', overrides => {
    expect(() => archiveRecord(Buffer.from('x'), metadata(overrides), validateConfig(config()))).toThrow('QUEUE_ARCHIVE_')
  })

  test('durable private bytes are reopened and verified, duplicate immutable identity does not overwrite', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-queue-test-'))
    const real = await fs.realpath(directory)
    const local = validateConfig(config({ outputDirectory: path.join(real, run) }))
    let store
    try {
      store = await createArchiveStore(local)
      const record = archiveRecord(Buffer.from('{ "version": 999, "new": true }\n'), metadata(), local)
      await expect(store.save(record)).resolves.toEqual(durable(record))
      await expect(store.save({ ...record, capturedAt: new Date().toISOString(), metadata: { ...record.metadata, deliveryCount: 2 } })).resolves.toEqual(durable(record))
      const filename = path.join(local.outputDirectory, `${record.key}.json`)
      expect((await fs.stat(filename)).mode & 0o777).toBe(0o600)
      expect((await fs.stat(local.outputDirectory)).mode & 0o777).toBe(0o700)
      expect(Buffer.from(JSON.parse(await fs.readFile(filename, 'utf8')).payload.data, 'base64').toString()).toBe('{ "version": 999, "new": true }\n')
      const changed = archiveRecord(Buffer.from('changed'), metadata(), local)
      await expect(store.save(changed)).rejects.toThrow('CHECKSUM_MISMATCH')
      expect(JSON.parse(await fs.readFile(filename, 'utf8')).payload.data).toBe(record.payload.data)
      await expect(createArchiveStore(local)).rejects.toThrow('ALREADY_LOCKED')
    } finally {
      if (store) await store.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  test('corrupt on-disk data prevents successful handler return/ack', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-queue-corrupt-'))
    const local = validateConfig(config({ outputDirectory: path.join(await fs.realpath(directory), run) }))
    const store = await createArchiveStore(local)
    try {
      const record = archiveRecord(Buffer.from('private-data'), metadata(), local)
      await store.save(record)
      await fs.writeFile(path.join(local.outputDirectory, `${record.key}.json`), JSON.stringify({ ...record, payload: { ...record.payload, data: 'eA==' } }))
      await expect(store.save(record)).rejects.toThrow('CHECKSUM_MISMATCH')
    } finally { await store.close(); await fs.rm(directory, { recursive: true, force: true }) }
  })

  test('manifest scope/config mismatch prevents a resumed foreign run', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-queue-scope-'))
    const local = validateConfig(config({ outputDirectory: path.join(await fs.realpath(directory), run) }))
    const store = await createArchiveStore(local)
    await store.close()
    try { await expect(createArchiveStore({ ...local, topic: 'talio-webhooks' })).rejects.toThrow('MANIFEST_MISMATCH') }
    finally { await fs.rm(directory, { recursive: true, force: true }) }
  })

  test('successful handler returns only after independently proved durability', async () => {
    const steps = [], input = config({ maxMessages: 1 })
    const receive = jest.fn(async (topic, group, handler, options) => {
      expect(topic).toBe(input.topic); expect(group).toBe(input.consumerGroup)
      expect(options).toEqual({ limit: 1, visibilityTimeoutSeconds: 60 })
      steps.push('lease-archive-group')
      await handler(Buffer.from('raw'), metadata())
      steps.push('ack-archive-group')
      return { ok: true }
    })
    const report = await runArchive({ config: input, receive, save: async record => { steps.push('durable-reopen-checksum'); return durable(record) } })
    expect(steps).toEqual(['lease-archive-group', 'durable-reopen-checksum', 'ack-archive-group'])
    expect(report).toMatchObject({ captured: 1, bytes: 3, complete: false, dispatch: 'never', stopReason: 'messages' })
    expect(receive).toHaveBeenCalledTimes(1)
  })

  test('duplicate deliveries retain byte/call bounds but never inflate unique captured count', async () => {
    const report = await runArchive({ config: config(), save: durable, receive: async (topic, group, handler) => { await handler(Buffer.from('raw'), metadata()); return { ok: true } } })
    expect(report).toMatchObject({ captured: 1, deliveries: 2, bytes: 6, archivedBytes: 3, stopReason: 'messages', countsScope: 'this-invocation-not-total-backlog' })
  })

  test.each([async () => { throw new Error('disk failed') }, async () => ({}), async record => ({ ...durable(record), sha256: 'wrong' })])('disk failure or unproven durability never acknowledges', async save => {
    const ack = jest.fn()
    const receive = async (topic, group, handler) => { await handler(Buffer.from('x'), metadata()); ack(); return { ok: true } }
    await expect(runArchive({ config: config(), receive, save })).rejects.toThrow()
    expect(ack).not.toHaveBeenCalled()
  })

  test('message/byte/time bounds fail without ack for over-limit delivered payload', async () => {
    const ack = jest.fn()
    const receive = async (topic, group, handler) => { await handler(Buffer.alloc(3), metadata()); ack(); return { ok: true } }
    await expect(runArchive({ config: config({ maxBytes: 2, maxMessageBytes: 2 }), receive, save: durable })).rejects.toThrow('BYTES_BOUND')
    expect(ack).not.toHaveBeenCalled()
    const noRead = jest.fn()
    let tick = 0
    const report = await runArchive({ config: config(), receive: noRead, save: durable, now: () => tick++ === 0 ? 0 : 6000 })
    expect(report.stopReason).toBe('duration'); expect(noRead).not.toHaveBeenCalled()
  })

  test('empty/quiet polls never constitute finite closure or authorize cutover', async () => {
    let tick = 0
    const report = await runArchive({ config: config(), receive: async () => ({ ok: false, reason: 'empty' }), save: durable, now: () => tick, sleep: async ms => { tick += ms } })
    expect(report).toMatchObject({ captured: 0, emptyPolls: 5, complete: false, producerPauseVerified: false, delayedCoverageVerified: false, sourcePartitionsVerified: false, stopReason: 'duration' })
  })

  test('scoped JWT claims reject development tokens and foreign project/team/subject', () => {
    const claims = { project_id: PROJECT, owner_id: TEAM, owner: OWNER, environment: 'production', project: 'talio', sub: `owner:${OWNER}:project:talio:environment:production` }
    expect(validateClaims(claims, config())).toBe(claims)
    for (const patch of [{ environment: 'development' }, { owner_id: 'other' }, { project_id: 'other' }, { sub: 'foreign' }]) expect(() => validateClaims({ ...claims, ...patch }, config())).toThrow('TOKEN_SCOPE_INVALID')
  })

  test('network guard allows only own receive/lease and blocks send/replay, old groups, other deployments/regions', async () => {
    const fetch = jest.fn(async () => new Response(null, { status: 204 }))
    const guarded = guardedQueueFetch(fetch, config(), new AbortController().signal)
    const base = `https://bom1.vercel-queue.com/api/v3/topic/talio-background/consumer/${config().consumerGroup}`
    await guarded(base, { method: 'POST' })
    await guarded(`${base}/lease/opaque`, { method: 'DELETE' })
    await guarded(`${base}/lease/opaque`, { method: 'PATCH' })
    for (const [url, options] of [[base, { method: 'GET' }], [base, { method: 'POST', headers: { 'Vqs-Deployment-Id': 'dpl_old' } }], [base.replace('bom1', 'iad1'), { method: 'POST' }], [base.replace(config().consumerGroup, 'old-group'), { method: 'POST' }], ['https://bom1.vercel-queue.com/api/v3/topic/talio-background', { method: 'POST' }], [`${base}/lease/x`, { method: 'POST' }]]) await expect(guarded(url, options)).rejects.toThrow('NETWORK_SCOPE_INVALID')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  test('CLI plan reads private config only; no token, queue or output directory touches', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-queue-plan-'))
    try {
      const filename = path.join(directory, 'config.json')
      await fs.writeFile(filename, JSON.stringify(config()), { mode: 0o600 })
      const report = await main(['--config', filename], {})
      expect(report).toMatchObject({ mode: 'plan', scopeHash: scopeHash(config()), complete: false, dispatch: 'never' })
      await expect(main(['--config', filename, '--execute'], {})).rejects.toThrow('NOT_CONFIRMED')
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })

  test('archive can begin before producer pause without fabricating its cutoff', () => {
    expect(validateConfig(config({ producerPauseObservedAt: null })).producerPauseObservedAt).toBeNull()
  })

  test('private official env pull file is parsed in-process, no unrelated secrets returned', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-queue-token-test-'))
    try {
      const filename = path.join(directory, 'env')
      await fs.writeFile(filename, 'VERCEL_OIDC_TOKEN="synthetic.jwt.only"\nOTHER_SECRET="never returned"\n', { mode: 0o600 })
      await expect(readToken(filename, {})).resolves.toBe('synthetic.jwt.only')
      await expect(readToken(filename, { TALIO_QUEUE_ARCHIVE_OIDC_TOKEN_FILE: filename })).rejects.toThrow('SOURCE_INVALID')
      await fs.chmod(filename, 0o644)
      await expect(readToken(filename, {})).rejects.toThrow('NOT_PRIVATE')
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })

  test('explicit token env file flags accept no ambiguous/unknown arguments', () => {
    expect(parseArguments(['--token-env-file', '/private/env', '--config', '/private/config', '--execute'])).toEqual({ tokenEnvFile: '/private/env', config: '/private/config', execute: true })
    for (const args of [['--config', 'x', '--config', 'y'], ['--config', 'x', '--send'], ['--config', '--execute'], ['--token-env-file', 'x']]) expect(() => parseArguments(args)).toThrow('ARGUMENTS_INVALID')
  })
})

describe('installed SDK ack contract (synthetic HTTP only, no provider requests)', () => {
  const oldFetch = global.fetch
  afterEach(() => { global.fetch = oldFetch })
  const response = () => new Response('--test-boundary\r\nContent-Type: application/json\r\nVqs-Message-Id: opaque_id\r\nVqs-Delivery-Count: 1\r\nVqs-Timestamp: 2026-10-10T00:00:00Z\r\nVqs-Receipt-Handle: synthetic-lease\r\n\r\n{ "futureVersion": 999 }\n\r\n--test-boundary--\r\n', { headers: { 'Content-Type': 'multipart/mixed; boundary=test-boundary' } })
  test.each([false, true])('real SDK acknowledges own group iff handler durability succeeds (fails=%s)', async fails => {
    const { PollingQueueClient, BufferTransport } = require('@vercel/queue')
    const steps = []
    const fakeFetch = jest.fn(async (url, init) => {
      expect(new Headers(init.headers).has('Vqs-Deployment-Id')).toBe(false)
      expect(url).toContain(config().consumerGroup)
      if (init.method === 'POST') { steps.push('receive'); return response() }
      if (init.method === 'DELETE') { steps.push('ack'); return new Response(null, { status: 204 }) }
      throw new Error('unexpected request')
    })
    global.fetch = guardedQueueFetch(fakeFetch, config(), new AbortController().signal)
    const client = new PollingQueueClient({ region: 'bom1', deploymentId: null, token: 'synthetic-only-token', transport: new BufferTransport() })
    const received = client.receive(config().topic, config().consumerGroup, async bytes => {
      expect(bytes.toString()).toBe('{ "futureVersion": 999 }\n')
      steps.push('durability-verified')
      if (fails) throw new Error('synthetic-disk-failure')
    }, { limit: 1, visibilityTimeoutSeconds: 60 })
    if (fails) { await expect(received).rejects.toThrow('synthetic-disk-failure'); expect(steps).toEqual(['receive', 'durability-verified']) }
    else { await expect(received).resolves.toEqual({ ok: true }); expect(steps).toEqual(['receive', 'durability-verified', 'ack']) }
  })
})
