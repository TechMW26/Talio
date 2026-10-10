#!/usr/bin/env node
'use strict'

// Opt-in native-driver acceptance. Never run implicitly during migration/import.
// All writes use a fresh test dataset; cleanup is scoped to that exact dataset
// and happens only after a private recoverable backup has been persisted.
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const os = require('node:os')
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const { gzipSync } = require('node:zlib')
const { pack, applicationRecordKey } = require('../../lib/platform/firestoreCodec.cjs')
const { assertTarget } = require('./core.cjs')

function plan(env, argv) {
  const flags = new Map()
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (!['--host', '--database', '--execute'].includes(flag) || flags.has(flag)) throw new Error('Unknown or repeated acceptance argument')
    if (flag === '--execute') flags.set(flag, true)
    else {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error('Explicit --host and --database values are required')
      flags.set(flag, value)
    }
  }
  const host = flags.get('--host'), databaseName = flags.get('--database')
  if (!host || !databaseName) throw new Error('Explicit --host and --database are required')
  const target = assertTarget(env.MONGODB_URI, env.MONGODB_DATABASE, host, databaseName)
  const execute = flags.has('--execute')
  if (execute && env.MONGODB_ACCEPTANCE_CONFIRM !== 'isolated-temporary-records') throw new Error('Explicit MONGODB_ACCEPTANCE_CONFIRM is required before writes')
  return { ...target, execute }
}

// Load the actual application modules with the project's existing SWC tool.
// No duplicated implementation, downloaded tooling, or runtime provider switch.
function applicationModule(filename, cache = new Map()) {
  filename = path.resolve(filename)
  if (cache.has(filename)) return cache.get(filename).exports
  const compiled = require('@swc/core').transformSync(fs.readFileSync(filename, 'utf8'), { filename, jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' }, module: { type: 'commonjs' } }).code
  const loaded = new Module(filename, module)
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  const nativeRequire = loaded.require.bind(loaded)
  loaded.require = request => {
    if (request.startsWith('./mongo') && request.endsWith('.server')) return applicationModule(path.resolve(path.dirname(filename), `${request}.js`), cache)
    return nativeRequire(request)
  }
  cache.set(filename, loaded)
  loaded._compile(compiled, filename)
  return loaded.exports
}

async function run(env, argv) {
  const target = plan(env, argv)
  if (!target.execute) { console.log(JSON.stringify({ event: 'acceptance-plan-only', ...target, writes: 0 })); return }
  const { MongoClient } = require('mongodb')
  const { createMongoDatabase } = applicationModule(path.resolve(__dirname, '../../lib/platform/mongoStore.server.js'))
  const { createMongoFirestoreFacade } = applicationModule(path.resolve(__dirname, '../../lib/platform/mongoFirestoreFacade.server.js'))
  const client = new MongoClient(env.MONGODB_URI, { appName: 'talio-isolated-acceptance', maxPoolSize: 3, minPoolSize: 0, promoteBuffers: true, serverSelectionTimeoutMS: 15000 })
  const dataset = `acceptance-${randomBytes(12).toString('hex')}`
  const backupDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'talio-mongo-acceptance-'))
  fs.chmodSync(backupDirectory, 0o700)
  const manifestFile = path.join(backupDirectory, 'run.json')
  fs.writeFileSync(manifestFile, JSON.stringify({ dataset, ...target, createdAt: new Date().toISOString(), status: 'started' }), { mode: 0o600 })
  let db, failure, passed = false, ownsNamespace = false
  try {
    await client.connect()
    db = client.db(target.databaseName)
    assert.equal(await db.collection('talio_records').countDocuments({ dataset }), 0)
    assert.equal(await db.collection('talio_unique_keys').countDocuments({ dataset }), 0)
    assert.equal(await db.collection('talio_catalogs').countDocuments({ _id: dataset }), 0)
    ownsNamespace = true
    const options = { db, client, dataset, queryFields: { items: ['rank', 'createdAt'] }, constraints: { users: [{ fields: ['email'] }] } }
    const first = createMongoDatabase({ ...options, databaseName: 'talio_company_acceptance_a' })
    const other = createMongoDatabase({ ...options, databaseName: 'talio_company_acceptance_b' })
    await first.create('items', { _id: 'shared-id', rank: 0, createdAt: null, count: 0, rows: [[1, 2]], bytes: Buffer.from('test-only'), owner: 'first' })
    await other.create('items', { _id: 'shared-id', rank: 99, owner: 'other' })
    assert.equal((await other.get('items', 'shared-id')).owner, 'other')
    const batched = await first.getMany('items', ['shared-id', 'missing', 'shared-id'])
    assert.equal(batched[1], null); assert.deepEqual(batched[0], batched[2])
    await Promise.all(Array.from({ length: 3 }, () => first.mutate('items', 'shared-id', record => ({ ...record, count: record.count + 1 }))))
    assert.equal((await first.get('items', 'shared-id')).count, 3)
    await first.create('items', { _id: 'dated-one', rank: 1, createdAt: new Date('2026-01-01T00:00:00Z') })
    await first.create('items', { _id: 'dated-two', rank: 2, createdAt: new Date('2026-01-02T00:00:00Z') })
    assert.equal(await first.count('items'), 3)
    assert.equal(await other.count('items'), 1)
    assert.equal(await first.count('items', [{ field: 'rank', operator: '>=', value: 1 }]), 2)
    const sort = { orderBy: [{ field: 'createdAt' }], limit: 1 }
    const page = await first.list('items', sort)
    assert.equal(page.records[0]._id, 'shared-id')
    assert.equal((await first.list('items', { ...sort, cursor: page.nextCursor })).records[0]._id, 'dated-one')
    await assert.rejects(other.list('items', { ...sort, cursor: page.nextCursor }), /tenant\/query/)
    await assert.rejects(first.transaction(async tx => { await tx.replace('items', { _id: 'dated-one', rank: 100 }); await tx.create('items', { _id: 'rollback' }); throw new Error('intentional-abort') }), /intentional-abort/)
    assert.equal(await first.get('items', 'rollback'), null)
    assert.equal((await first.get('items', 'dated-one')).rank, 1)
    const duplicates = await Promise.allSettled(['user-one', 'user-two'].map(_id => first.create('users', { _id, email: 'acceptance@example.invalid' })))
    assert.equal(duplicates.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(duplicates.find(result => result.status === 'rejected').reason.code, 'ALREADY_EXISTS')
    await other.create('users', { _id: 'user-one', email: 'acceptance@example.invalid' })
    const winner = duplicates[0].status === 'fulfilled' ? 'user-one' : 'user-two'
    await first.delete('users', winner)
    await first.create('users', { _id: 'released-user', email: 'acceptance@example.invalid' })
    const facade = createMongoFirestoreFacade({ db, client, dataset })
    const root = facade.collection('talioDatasets').doc(dataset)
    await facade.runTransaction(tx => tx.create(root, { status: 'acceptance-only', tenants: [] }))
    await facade.runTransaction(async tx => { const [one, two] = await Promise.all([tx.get(root), tx.get(root)]); assert.equal(one.get('status'), two.get('status')); tx.update(root, { status: 'acceptance-complete' }) })
    assert.equal((await root.get()).get('status'), 'acceptance-complete')
    // Exercise actual embedded overflow parts with incompressible bytes, not
    // merely a small inline Buffer that could conceal a codec/driver mismatch.
    const overflowBytes = randomBytes(600 * 1024)
    await first.create('items', { _id: 'overflow-record', rank: 3, bytes: overflowBytes })
    assert.deepEqual((await first.get('items', 'overflow-record')).bytes, overflowBytes)
    const overflowDocument = await db.collection('talio_records').findOne({ dataset, databaseName: first.databaseName, collectionName: 'items', recordKey: applicationRecordKey('overflow-record') })
    assert.ok(overflowDocument.parts.length > 0)
    passed = true
  } catch (error) { failure = error }
  finally {
    if (db && ownsNamespace) {
      try {
        const records = await db.collection('talio_records').find({ dataset }).limit(101).toArray()
        const claims = await db.collection('talio_unique_keys').find({ dataset }).limit(101).toArray()
        const catalog = await db.collection('talio_catalogs').findOne({ _id: dataset })
        if (records.length > 100 || claims.length > 100) throw new Error('Acceptance cleanup bound exceeded; nothing deleted')
        const backupFile = path.join(backupDirectory, 'temporary-records.pack.json.gz')
        fs.writeFileSync(backupFile, gzipSync(Buffer.from(JSON.stringify(pack({ records, claims, catalog })))), { mode: 0o600 })
        await db.collection('talio_records').deleteMany({ dataset })
        await db.collection('talio_unique_keys').deleteMany({ dataset })
        await db.collection('talio_catalogs').deleteOne({ _id: dataset })
        assert.equal(await db.collection('talio_records').countDocuments({ dataset }), 0)
        assert.equal(await db.collection('talio_unique_keys').countDocuments({ dataset }), 0)
        assert.equal(await db.collection('talio_catalogs').countDocuments({ _id: dataset }), 0)
        fs.writeFileSync(manifestFile, JSON.stringify({ dataset, ...target, completedAt: new Date().toISOString(), status: passed ? 'passed' : 'failed', cleanup: 'complete', backupFile }), { mode: 0o600 })
        console.log(JSON.stringify({ event: passed ? 'native-acceptance-passed' : 'native-acceptance-failed', dataset, backupDirectory, cleanup: 'exact-test-dataset-only' }))
      } catch (cleanupError) { failure ||= cleanupError; console.log(JSON.stringify({ event: 'acceptance-cleanup-needs-attention', dataset, backupDirectory })) }
    }
    await client.close()
  }
  if (failure) throw failure
}

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true })
  run(process.env, process.argv.slice(2)).catch(error => {
    // Driver errors may contain URIs; output only a stable error name/code.
    console.error(JSON.stringify({ event: 'acceptance-error', name: error.name, code: error.code || 'ACCEPTANCE_FAILED' }))
    process.exitCode = 1
  })
}
module.exports = { plan, run, applicationModule }
