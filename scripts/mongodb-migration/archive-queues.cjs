#!/usr/bin/env node
'use strict'

// OFFLINE ONLY. This archives, never executes, queue payloads. A NEW poll group
// leaves old push groups untouched. Its handler resolves (therefore SDK acks)
// only AFTER a private file is fsynced, linked without overwrite, directory
// fsynced, and independently reopened/checksummed. No replay/send entrypoint.
// https://vercel.com/docs/queues/poll-mode
// https://vercel.com/docs/queues/api
// https://vercel.com/docs/oidc/reference
const fs = require('node:fs/promises')
const path = require('node:path')
const { constants } = require('node:fs')
const { randomUUID } = require('node:crypto')
const { sha256 } = require('./core.cjs')

const PROJECT = 'prj_oeAvg1xGfwnBqG8G3LdI0n0PofDY'
const TEAM = 'team_SrYNPxCVgIqvMkR0esfDUwj6'
const OWNER = 'avirajsharma-5715s-projects'
const TOPICS = ['talio-background', 'talio-webhooks']
const REGIONS = ['arn1', 'bom1', 'cdg1', 'cle1', 'cpt1', 'dub1', 'dxb1', 'fra1', 'gru1', 'hkg1', 'hnd1', 'iad1', 'icn1', 'kix1', 'lhr1', 'pdx1', 'sfo1', 'sin1', 'syd1', 'yul1']
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const RETENTION_CEILING_SECONDS = 604800 // Provider MAXIMUM, not actual retention.
const fail = code => { throw new Error(code) }
const bounded = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max

function validateConfig(input) {
  if (!input || input.projectId !== PROJECT || input.teamId !== TEAM || input.owner !== OWNER || input.environment !== 'production') fail('QUEUE_ARCHIVE_SCOPE_INVALID')
  if (!REGIONS.includes(input.region) || !TOPICS.includes(input.topic) || !UUID.test(input.run || '')) fail('QUEUE_ARCHIVE_SCOPE_INVALID')
  const consumerGroup = `talio-migration-archive-${input.run}`
  if (input.consumerGroup !== consumerGroup || input.deploymentId !== null) fail('QUEUE_ARCHIVE_GROUP_INVALID')
  if (!bounded(input.maxMessages, 100000) || !bounded(input.maxBytes, 1024 ** 3) || !bounded(input.maxDurationSeconds, 3600) || !bounded(input.maxMessageBytes, 2 * 1024 ** 2) || input.maxMessageBytes > input.maxBytes || !bounded(input.pollIntervalMs, 60000) || input.pollIntervalMs < 1000) fail('QUEUE_ARCHIVE_BOUNDS_INVALID')
  if (!path.isAbsolute(input.outputDirectory || '') || !UUID.test(path.basename(input.outputDirectory))) fail('QUEUE_ARCHIVE_DIRECTORY_INVALID')
  if (path.basename(input.outputDirectory) !== input.run) fail('QUEUE_ARCHIVE_DIRECTORY_INVALID')
  const pausedAt = input.producerPauseObservedAt === null ? null : new Date(input.producerPauseObservedAt)
  if (pausedAt !== null && (!Number.isFinite(pausedAt.getTime()) || typeof input.producerPauseObservedAt !== 'string')) fail('QUEUE_ARCHIVE_WINDOW_INVALID')
  // This caller-provided observation is NOT proof that all producers stopped.
  const config = Object.fromEntries(['projectId', 'teamId', 'owner', 'environment', 'region', 'topic', 'run', 'consumerGroup', 'deploymentId', 'maxMessages', 'maxBytes', 'maxDurationSeconds', 'maxMessageBytes', 'pollIntervalMs', 'outputDirectory'].map(key => [key, input[key]]))
  config.producerPauseObservedAt = pausedAt?.toISOString() ?? null
  return Object.freeze(config)
}

function scopeHash(config) {
  return sha256(JSON.stringify([config.projectId, config.teamId, config.environment, config.region, config.topic, config.run, config.consumerGroup, null]))
}

function archiveRecord(payload, metadata, config, observedAt = new Date()) {
  if (!Buffer.isBuffer(payload)) fail('QUEUE_ARCHIVE_RAW_BYTES_REQUIRED')
  if (!metadata || metadata.topicName !== config.topic || metadata.consumerGroup !== config.consumerGroup || metadata.region !== config.region || typeof metadata.messageId !== 'string' || !metadata.messageId || metadata.messageId.length > 4096) fail('QUEUE_ARCHIVE_METADATA_SCOPE_INVALID')
  if (!Number.isSafeInteger(metadata.deliveryCount) || metadata.deliveryCount < 1 || !(metadata.createdAt instanceof Date) || !Number.isFinite(metadata.createdAt.getTime()) || !(metadata.expiresAt instanceof Date) || !Number.isFinite(metadata.expiresAt.getTime())) fail('QUEUE_ARCHIVE_METADATA_INVALID')
  const key = sha256(JSON.stringify([config.projectId, config.environment, config.region, config.topic, metadata.messageId]))
  return {
    version: 1, key, scopeHash: scopeHash(config), run: config.run,
    source: { projectId: config.projectId, teamId: config.teamId, environment: config.environment, region: config.region, topic: config.topic, messageId: metadata.messageId },
    consumerGroup: config.consumerGroup, capturedAt: observedAt.toISOString(),
    metadata: { createdAt: metadata.createdAt.toISOString(), sdkReportedExpiresAt: metadata.expiresAt.toISOString(), expiresAtAuthoritative: false, deliveryCount: metadata.deliveryCount,
      // Public 0.5.1 metadata does not expose these. Preserve unknowns explicitly.
      originalDeploymentId: null, originalDelaySeconds: null, originalVisibleAt: null, originalContentType: null, metadataSource: '@vercel/queue@0.5.1-public-handler' },
    payload: { encoding: 'base64', bytes: payload.length, sha256: sha256(payload), data: payload.toString('base64') },
    dispatch: 'never', completeness: false,
  }
}

function verifyRecord(value, expected) {
  if (!value || value.version !== 1 || value.key !== expected.key || value.scopeHash !== expected.scopeHash || value.run !== expected.run || JSON.stringify(value.source) !== JSON.stringify(expected.source) || value.consumerGroup !== expected.consumerGroup || value.metadata?.createdAt !== expected.metadata.createdAt || value.dispatch !== 'never' || value.completeness !== false || value.payload?.encoding !== 'base64') fail('QUEUE_ARCHIVE_RECORD_MISMATCH')
  for (const key of ['expiresAtAuthoritative', 'originalDeploymentId', 'originalDelaySeconds', 'originalVisibleAt', 'originalContentType', 'metadataSource']) if (value.metadata[key] !== expected.metadata[key]) fail('QUEUE_ARCHIVE_RECORD_MISMATCH')
  if (typeof value.payload.data !== 'string') fail('QUEUE_ARCHIVE_CHECKSUM_MISMATCH')
  const bytes = Buffer.from(value.payload.data, 'base64')
  if (bytes.toString('base64') !== value.payload.data || bytes.length !== value.payload.bytes || value.payload.sha256 !== expected.payload.sha256 || sha256(bytes) !== value.payload.sha256 || bytes.length !== expected.payload.bytes) fail('QUEUE_ARCHIVE_CHECKSUM_MISMATCH')
  return value
}

async function privateDirectory(directory) {
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) fail('QUEUE_ARCHIVE_DIRECTORY_NOT_PRIVATE')
  if (await fs.realpath(directory) !== directory) fail('QUEUE_ARCHIVE_SYMLINK_FORBIDDEN')
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

async function privateRead(filename) {
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.mode & 0o077 || (process.getuid && stat.uid !== process.getuid()) || stat.size > 4 * 1024 ** 2) fail('QUEUE_ARCHIVE_FILE_NOT_PRIVATE')
    return await handle.readFile('utf8')
  } finally { await handle.close() }
}

async function durableCreate(filename, bytes) {
  const directory = path.dirname(filename)
  const temporary = path.join(directory, `.${randomUUID()}.tmp`)
  const handle = await fs.open(temporary, 'wx', 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  try {
    // link is atomic and fails if destination exists, never overwriting archives.
    try { await fs.link(temporary, filename) } catch (error) { if (error.code !== 'EEXIST') throw error }
    await syncDirectory(directory)
  } finally { await fs.unlink(temporary) }
  return privateRead(filename)
}

async function createArchiveStore(config) {
  await privateDirectory(path.dirname(config.outputDirectory))
  try { await fs.mkdir(config.outputDirectory, { mode: 0o700 }); await syncDirectory(path.dirname(config.outputDirectory)) } catch (error) { if (error.code !== 'EEXIST') throw error }
  await privateDirectory(config.outputDirectory)
  const manifest = { version: 1, config, scopeHash: scopeHash(config), sdk: '@vercel/queue@0.5.1', mode: 'archive-only-new-consumer', complete: false, retentionCeilingSeconds: RETENTION_CEILING_SECONDS, originalDelayAndDeploymentMetadataAvailable: false, closureGate: 'provider-backed partition/high-watermark/delayed inventory plus receipt reconciliation; empty polls NEVER prove completion' }
  const stored = JSON.parse(await durableCreate(path.join(config.outputDirectory, 'scope.json'), JSON.stringify(manifest)))
  if (JSON.stringify(stored) !== JSON.stringify(manifest)) fail('QUEUE_ARCHIVE_MANIFEST_MISMATCH')
  const lockFile = path.join(config.outputDirectory, '.lock')
  const lock = await fs.open(lockFile, 'wx', 0o600).catch(() => fail('QUEUE_ARCHIVE_ALREADY_LOCKED'))
  await lock.writeFile(JSON.stringify({ pid: process.pid, scopeHash: scopeHash(config) })); await lock.sync()
  return {
    async save(record) {
      const filename = path.join(config.outputDirectory, `${record.key}.json`)
      const storedRecord = JSON.parse(await durableCreate(filename, JSON.stringify(record)))
      verifyRecord(storedRecord, record) // independent reopened bytes, BEFORE ack
      return { key: record.key, bytes: record.payload.bytes, sha256: record.payload.sha256 }
    },
    async close() { await lock.close(); await fs.unlink(lockFile); await syncDirectory(config.outputDirectory) },
  }
}

async function runArchive({ config: input, receive, save, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), signal }) {
  const config = validateConfig(input)
  const started = now(), deadline = started + config.maxDurationSeconds * 1000
  const seen = new Set()
  const report = { version: 1, scopeHash: scopeHash(config), captured: 0, deliveries: 0, bytes: 0, archivedBytes: 0, countsScope: 'this-invocation-not-total-backlog', emptyPolls: 0, complete: false, dispatch: 'never', stopReason: null, producerPauseVerified: false, delayedCoverageVerified: false, sourcePartitionsVerified: false,
    window: { producerPauseObservedAt: config.producerPauseObservedAt, providerMaximumRetentionSeconds: RETENTION_CEILING_SECONDS, providerHighWatermark: null, observedCreatedAtMin: null, observedCreatedAtMax: null, originalDelayedVisibilityKnown: false } }
  while (true) {
    if (signal?.aborted || now() >= deadline) { report.stopReason = 'duration'; break }
    if (report.deliveries >= config.maxMessages) { report.stopReason = 'messages'; break }
    if (report.bytes >= config.maxBytes) { report.stopReason = 'bytes'; break }
    let handled = 0
    const result = await receive(config.topic, config.consumerGroup, async (payload, metadata) => {
      if (++handled !== 1) fail('QUEUE_ARCHIVE_BATCH_BOUND_EXCEEDED')
      if (signal?.aborted || now() >= deadline) fail('QUEUE_ARCHIVE_DURATION_BOUND')
      if (!Buffer.isBuffer(payload) || payload.length > config.maxMessageBytes || report.bytes + payload.length > config.maxBytes) fail('QUEUE_ARCHIVE_BYTES_BOUND')
      const record = archiveRecord(payload, metadata, config, new Date(now()))
      const durable = await save(record)
      if (durable?.key !== record.key || durable.bytes !== payload.length || durable.sha256 !== record.payload.sha256) fail('QUEUE_ARCHIVE_DURABILITY_UNPROVEN')
      report.deliveries++; report.bytes += payload.length
      if (!seen.has(record.key)) { seen.add(record.key); report.captured++; report.archivedBytes += payload.length }
      const created = record.metadata.createdAt
      if (!report.window.observedCreatedAtMin || created < report.window.observedCreatedAtMin) report.window.observedCreatedAtMin = created
      if (!report.window.observedCreatedAtMax || created > report.window.observedCreatedAtMax) report.window.observedCreatedAtMax = created
      // No business function, no return payload; successful return lets SDK ack
      // ONLY the new archival consumer. Ack failure can safely redeliver.
    }, { limit: 1, visibilityTimeoutSeconds: 60 })
    if (result?.ok === false && result.reason === 'empty' && handled === 0) {
      report.emptyPolls++
      await sleep(Math.min(config.pollIntervalMs, Math.max(0, deadline - now())))
    } else if (result?.ok !== true || handled !== 1) fail('QUEUE_ARCHIVE_RECEIVE_FAILED')
  }
  report.elapsedMs = now() - started
  return report
}

function boundedTransport(BufferTransport, maxMessageBytes) {
  return new class extends BufferTransport {
    async deserialize(stream) {
      const reader = stream.getReader(), chunks = []
      let bytes = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) return Buffer.concat(chunks, bytes)
          bytes += chunk.value.byteLength
          if (bytes > maxMessageBytes) { await reader.cancel(); fail('QUEUE_ARCHIVE_BYTES_BOUND') }
          chunks.push(Buffer.from(chunk.value))
        }
      } finally { reader.releaseLock() }
    }
  }()
}

function validateClaims(claims, config) {
  if (claims.project_id !== config.projectId || claims.owner_id !== config.teamId || claims.owner !== config.owner || claims.environment !== config.environment || typeof claims.project !== 'string' || claims.sub !== `owner:${config.owner}:project:${claims.project}:environment:${config.environment}`) fail('QUEUE_ARCHIVE_TOKEN_SCOPE_INVALID')
  return claims
}

async function verifyToken(token, config) {
  const { decodeJwt, jwtVerify, createLocalJWKSet } = await import('jose')
  // Unverified issuer is used only to select from these TWO fixed trusted URLs.
  const issuer = decodeJwt(token).iss
  if (!['https://oidc.vercel.com', `https://oidc.vercel.com/${OWNER}`].includes(issuer)) fail('QUEUE_ARCHIVE_TOKEN_ISSUER_INVALID')
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10000), redirect: 'error' })
  if (!response.ok) fail('QUEUE_ARCHIVE_OIDC_DISCOVERY_FAILED')
  const discovery = await response.json()
  const jwks = new URL(discovery.jwks_uri)
  if (discovery.issuer !== issuer || jwks.origin !== 'https://oidc.vercel.com' || jwks.username || jwks.password) fail('QUEUE_ARCHIVE_OIDC_DISCOVERY_INVALID')
  const keysResponse = await fetch(jwks, { signal: AbortSignal.timeout(10000), redirect: 'error' })
  if (!keysResponse.ok) fail('QUEUE_ARCHIVE_OIDC_KEYS_FAILED')
  const { payload } = await jwtVerify(token, createLocalJWKSet(await keysResponse.json()), { issuer, audience: `https://vercel.com/${OWNER}`, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'project_id', 'owner_id', 'environment'] })
  return validateClaims(payload, config)
}

// Standalone-process transport guard: never send, replay, contact foreign scope,
// log raw SDK errors/receipt handles, or leave an unbounded network request.
function guardedQueueFetch(originalFetch, config, signal) {
  const base = `/api/v3/topic/${config.topic}/consumer/${config.consumerGroup}`
  return async (url, init = {}) => {
    const parsed = new URL(url), headers = new Headers(init.headers)
    const receive = parsed.pathname === base && init.method === 'POST'
    const lease = parsed.pathname.startsWith(`${base}/lease/`) && parsed.pathname.slice(`${base}/lease/`.length).length > 0 && !parsed.pathname.slice(`${base}/lease/`.length).includes('/') && ['DELETE', 'PATCH'].includes(init.method)
    if (parsed.origin !== `https://${config.region}.vercel-queue.com` || parsed.username || parsed.password || parsed.search || parsed.hash || headers.has('Vqs-Deployment-Id') || (!receive && !lease)) fail('QUEUE_ARCHIVE_NETWORK_SCOPE_INVALID')
    return originalFetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) })
  }
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArguments(argv)
  const config = validateConfig(JSON.parse(await privateRead(path.resolve(options.config))))
  const plan = { mode: 'plan', scopeHash: scopeHash(config), maxMessages: config.maxMessages, maxBytes: config.maxBytes, maxDurationSeconds: config.maxDurationSeconds, complete: false, dispatch: 'never', requiresScopedProductionOidc: true }
  if (!options.execute && !options.verifyAuth) return plan
  if (options.execute && (env.TALIO_CONFIRM_QUEUE_ARCHIVE !== config.run || env.NODE_ENV === 'development' || env.VERCEL_QUEUE_DEBUG === '1' || env.VERCEL_QUEUE_DEBUG === 'true')) fail('QUEUE_ARCHIVE_EXECUTION_NOT_CONFIRMED')
  const token = await readToken(options.tokenEnvFile, env)
  const claims = await verifyToken(token, config)
  // Read-only public JWKS verification; no SDK load, queue call or group creation.
  if (!options.execute) return { ...plan, authenticationVerified: true, tokenRemainingSeconds: Math.max(0, claims.exp - Math.floor(Date.now() / 1000)) }
  // Never continue past token expiry: no implicit token refresh/foreign scope.
  const durationMs = Math.min(config.maxDurationSeconds * 1000, claims.exp * 1000 - Date.now() - 10000)
  if (durationMs <= 0) fail('QUEUE_ARCHIVE_TOKEN_TOO_SHORT')
  const store = await createArchiveStore(config)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), durationMs)
  const originalFetch = global.fetch, originalConsole = { warn: console.warn, error: console.error, debug: console.debug }
  let sdkWarnings = 0
  try {
    const { PollingQueueClient, BufferTransport } = require('@vercel/queue')
    const sdkVersion = require(path.join(path.dirname(require.resolve('@vercel/queue')), '../package.json')).version
    if (sdkVersion !== '0.5.1') fail('QUEUE_ARCHIVE_SDK_REVIEW_REQUIRED')
    console.warn = console.error = console.debug = () => { sdkWarnings++ }
    global.fetch = guardedQueueFetch(originalFetch, config, controller.signal)
    const client = new PollingQueueClient({ region: config.region, token, deploymentId: null, transport: boundedTransport(BufferTransport, config.maxMessageBytes) })
    const receive = async (...args) => {
      const result = await client.receive(...args)
      if (sdkWarnings) fail('QUEUE_ARCHIVE_SDK_WARNING') // parser omissions must not look empty
      return result
    }
    const report = await runArchive({ config, receive, save: store.save, signal: controller.signal })
    await durableCreate(path.join(config.outputDirectory, `report-${randomUUID()}.json`), JSON.stringify(report))
    // Dates/metadata remain private; stdout contains aggregate states only.
    const { window, ...aggregate } = report
    return aggregate
  } finally {
    clearTimeout(timer); global.fetch = originalFetch; Object.assign(console, originalConsole)
    await store.close()
  }
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index++) {
    const name = { '--config': 'config', '--token-env-file': 'tokenEnvFile', '--execute': 'execute', '--verify-auth': 'verifyAuth' }[argv[index]]
    if (!name || Object.hasOwn(options, name)) fail('QUEUE_ARCHIVE_ARGUMENTS_INVALID')
    if (name === 'execute' || name === 'verifyAuth') options[name] = true
    else {
      const value = argv[++index]
      if (!value || value.startsWith('--')) fail('QUEUE_ARCHIVE_ARGUMENTS_INVALID')
      options[name] = value
    }
  }
  if (!options.config) fail('QUEUE_ARCHIVE_ARGUMENTS_INVALID')
  return options
}

async function readToken(tokenEnvFile, env) {
  // Accept a provider-generated private env file without printing/extracting any
  // of its other credentials or editing actual local/production env settings.
  if (tokenEnvFile) {
    if (env.TALIO_QUEUE_ARCHIVE_OIDC_TOKEN_FILE || !path.isAbsolute(tokenEnvFile)) fail('QUEUE_ARCHIVE_TOKEN_SOURCE_INVALID')
    const parsed = require('dotenv').parse(await privateRead(tokenEnvFile))
    if (!parsed.VERCEL_OIDC_TOKEN?.trim()) fail('QUEUE_ARCHIVE_TOKEN_MISSING')
    return parsed.VERCEL_OIDC_TOKEN.trim()
  }
  if (!path.isAbsolute(env.TALIO_QUEUE_ARCHIVE_OIDC_TOKEN_FILE || '')) fail('QUEUE_ARCHIVE_TOKEN_SOURCE_INVALID')
  const token = (await privateRead(env.TALIO_QUEUE_ARCHIVE_OIDC_TOKEN_FILE)).trim()
  if (!token) fail('QUEUE_ARCHIVE_TOKEN_MISSING')
  return token
}

module.exports = { PROJECT, TEAM, OWNER, validateConfig, scopeHash, archiveRecord, verifyRecord, createArchiveStore, runArchive, boundedTransport, validateClaims, verifyToken, guardedQueueFetch, parseArguments, readToken, main }
if (require.main === module) main().then(report => process.stdout.write(`${JSON.stringify(report)}\n`)).catch(() => { process.stderr.write('QUEUE_ARCHIVE_STOPPED; saved files retained; completeness unproven\n'); process.exitCode = 1 })
