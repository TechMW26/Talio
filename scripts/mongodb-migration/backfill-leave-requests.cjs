#!/usr/bin/env node
'use strict'

/**
 * Safe backfill for leave requests created before leave types were stored as
 * codes and before server-side day counts were enforced.
 *
 * Usage:
 *   MONGODB_URI=... MONGODB_DATABASE=talio_company_x MONGODB_DATASET=... \
 *     node scripts/mongodb-migration/backfill-leave-requests.cjs
 *   ... --apply
 *
 * Dry-run is the default. --apply only updates leaveType/days/numberOfDays;
 * nothing is deleted.
 */
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { MongoClient } = require('mongodb')

function applicationModule(filename, cache = new Map()) {
  filename = path.resolve(filename)
  if (cache.has(filename)) return cache.get(filename).exports
  const compiled = require('@swc/core').transformSync(fs.readFileSync(filename, 'utf8'), {
    filename,
    jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  }).code
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  const nativeRequire = loaded.require.bind(loaded)
  loaded.require = request => {
    if (request.startsWith('.') && !request.endsWith('.cjs')) {
      const resolved = path.resolve(path.dirname(filename), request.endsWith('.js') ? request : `${request}.js`)
      return applicationModule(resolved, cache)
    }
    return nativeRequire(request)
  }
  cache.set(filename, loaded)
  loaded._compile(compiled, filename)
  return loaded.exports
}

function args(argv) {
  const options = { apply: false, databaseName: process.env.MONGODB_DATABASE, dataset: process.env.MONGODB_DATASET }
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (flag === '--apply') options.apply = true
    else if (flag === '--database') options.databaseName = argv[++index]
    else if (flag === '--dataset') options.dataset = argv[++index]
    else throw new Error(`Unknown argument: ${flag}`)
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required')
  if (!/^talio_company_[A-Za-z0-9_-]+$/.test(String(options.databaseName || ''))) throw new Error('A registered --database/MONGODB_DATABASE is required')
  if (!/^[a-z][a-z0-9-]{7,79}$/.test(String(options.dataset || ''))) throw new Error('An explicit --dataset/MONGODB_DATASET is required')
  return options
}

function typeIndex(types) {
  const byId = new Map(), byCode = new Map(), byName = new Map()
  for (const type of types) {
    if (!type) continue
    byId.set(String(type._id), type)
    if (type.code) byCode.set(String(type.code).trim().toLowerCase(), type)
    if (type.name) byName.set(String(type.name).trim().toLowerCase(), type)
  }
  return value => {
    if (value && typeof value === 'object') return byId.get(String(value._id || '')) || null
    const key = String(value || '').trim().toLowerCase()
    if (!key) return null
    return byId.get(String(value)) || byCode.get(key) || byName.get(key) || null
  }
}

async function run() {
  const options = args(process.argv.slice(2))
  const { createMongoDatabase } = applicationModule(path.resolve(__dirname, '../../lib/platform/mongoStore.server.js'))
  const { collectFirestorePages } = applicationModule(path.resolve(__dirname, '../../lib/platform/firestoreQueries.server.js'))
  const { countLeaveDays } = applicationModule(path.resolve(__dirname, '../../lib/leaveDays.js'))

  const client = new MongoClient(process.env.MONGODB_URI, {
    appName: 'talio-leave-request-backfill',
    maxPoolSize: 3,
    minPoolSize: 0,
    promoteBuffers: true,
    serverSelectionTimeoutMS: 15000,
  })

  try {
    await client.connect()
    const database = createMongoDatabase({
      client,
      db: client.db(options.databaseName),
      dataset: options.dataset,
      databaseName: options.databaseName,
    })
    const [types, leaves] = await Promise.all([
      collectFirestorePages(database, 'leavetypes'),
      collectFirestorePages(database, 'leaves'),
    ])
    const resolveType = typeIndex(types)
    const result = { scanned: leaves.length, updates: 0, missingType: 0, skipped: 0, examples: [], applied: options.apply }

    for (const leave of leaves) {
      const type = resolveType(leave.leaveType) || resolveType(leave.leaveTypeCode) || resolveType(leave.leaveTypeName)
      const patch = {}
      if (type && leave.leaveType !== type.code) patch.leaveType = type.code
      const days = Number(leave.numberOfDays ?? leave.days)
      if (!Number.isFinite(days) || days <= 0) {
        const requestType = leave.requestType || (leave.isHalfDay ? 'half_day' : leave.workFromHome ? 'work_from_home' : 'leave')
        const computed = requestType === 'half_day' ? 0.5 : requestType === 'leave' ? countLeaveDays(leave.startDate, leave.endDate) : 0
        if (computed > 0) {
          patch.numberOfDays = computed
          patch.days = computed
        }
      }
      if (!type) {
        if (leave.leaveType) result.missingType++
        else result.skipped++
      }
      if (!Object.keys(patch).length) continue
      result.updates++
      if (result.examples.length < 10) result.examples.push({ id: leave._id, leaveType: patch.leaveType || leave.leaveType, days: patch.days })
      if (options.apply) {
        await database.mutate('leaves', String(leave._id), current => ({ ...current, ...patch, updatedAt: new Date() }))
      }
    }

    console.log(JSON.stringify(result, null, 2))
  } finally {
    await client.close()
  }
}

run().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
