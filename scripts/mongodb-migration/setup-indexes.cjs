#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const { assertTarget } = require('./core.cjs')
const { PREFIX, RECORD_INDEXES, validateIndexes, installRecordIndexes } = require('./indexes.cjs')

function indexNames(plan, names = new Set()) {
  if (!plan || typeof plan !== 'object') return names
  if (plan.indexName) names.add(plan.indexName)
  for (const value of Object.values(plan)) if (value && typeof value === 'object') {
    if (Array.isArray(value)) value.forEach(child => indexNames(child, names))
    else indexNames(value, names)
  }
  return names
}

/** Uses actual scoped samples, never fabricated IDs that prove nothing about
 * index selectivity. Missing domains are reported as unmeasured, not a pass. */
async function explainHotQueries(db, { dataset, databaseName }) {
  if (!/^[a-z][a-z0-9-]{7,79}$/.test(dataset || '') || !/^talio_company_[A-Za-z0-9_-]+$/.test(databaseName || '')) throw new Error('EXPLICIT_EXPLAIN_TENANT_REQUIRED')
  const records = db.collection('talio_records')
  const scope = name => ({ dataset, databaseName, collectionName: name })
  const sample = (name, fields) => records.findOne({ ...scope(name), ...Object.fromEntries(fields.map(field => [`envelope.data.${field}`, { $exists: true }])) }, { projection: { _id: 0, ...Object.fromEntries(fields.map(field => [`envelope.data.${field}`, 1])) } })
  const user = await sample('users', ['email'])
  const employee = await sample('employees', ['userId'])
  const attendance = await sample('attendances', ['employee', 'date'])
  const screenshot = await sample('screenshots', ['user', 'dateString', 'capturedAt'])
  const session = await sample('usersessions', ['tokenId'])
  const task = await sample('tasks', ['project', 'status', 'order'])
  const assignment = await sample('taskassignees', ['task'])
  const cases = []
  const add = (name, collection, filters, sort = { recordKey: 1 }, limit = 3, customScope) => {
    // Match the application repository's actual predicates, including field
    // existence required by partial indexes and scalar/array equality parity.
    const conditions = Object.entries(filters).map(([field, value]) => ({ [field]: value && typeof value === 'object' && !(value instanceof Date)
      ? { $exists: true, ...value }
      : { $exists: true, $eq: value, $not: { $type: 'array' } } }))
    cases.push({ name, filter: { $and: [customScope || scope(collection), ...conditions] }, sort, limit })
  }
  const unmeasured = []
  if (user) {
    add('login-email', 'users', { 'envelope.data.email': user.envelope.data.email })
    add('tenant-email-mapping', 'usertenantmappings', { 'envelope.data.email': user.envelope.data.email }, undefined, undefined, { dataset, databaseName: 'talio_superadmin', collectionName: 'usertenantmappings' })
  } else unmeasured.push('login-email', 'tenant-email-mapping')
  if (session) add('session-token', 'usersessions', { 'envelope.data.tokenId': session.envelope.data.tokenId })
  else unmeasured.push('session-token')
  if (employee) add('employee-user-link', 'employees', { 'envelope.data.userId': employee.envelope.data.userId })
  else unmeasured.push('employee-user-link')
  if (attendance) add('attendance-employee-day', 'attendances', { 'envelope.data.employee': attendance.envelope.data.employee, 'envelope.data.date': { $gte: attendance.envelope.data.date, $lt: new Date(+attendance.envelope.data.date + 86400000) } }, { 'envelope.data.date': 1, recordKey: 1 })
  else unmeasured.push('attendance-employee-day')
  if (screenshot) {
    add('capture-owner-day', 'screenshots', { 'envelope.data.user': screenshot.envelope.data.user, 'envelope.data.dateString': screenshot.envelope.data.dateString }, undefined, 101)
    add('capture-owner-time', 'screenshots', { 'envelope.data.user': screenshot.envelope.data.user, 'envelope.data.capturedAt': { $gte: screenshot.envelope.data.capturedAt } }, { 'envelope.data.capturedAt': 1, recordKey: 1 }, 101)
  } else unmeasured.push('capture-owner-day', 'capture-owner-time')
  if (task) {
    add('project-task-list', 'tasks', { 'envelope.data.project': task.envelope.data.project })
    add('project-custom-kanban-status', 'tasks', { 'envelope.data.project': task.envelope.data.project, 'envelope.data.status': task.envelope.data.status })
    add('project-last-task-order', 'tasks', { 'envelope.data.project': task.envelope.data.project, 'envelope.data.order': { $exists: true } }, { 'envelope.data.order': -1, recordKey: 1 }, 1)
  } else unmeasured.push('project-task-list', 'project-custom-kanban-status', 'project-last-task-order')
  if (assignment) add('task-assignee-list', 'taskassignees', { 'envelope.data.task': assignment.envelope.data.task })
  else unmeasured.push('task-assignee-list')
  const reports = []
  for (const example of cases) {
    const explained = await records.find(example.filter).sort(example.sort).limit(example.limit).explain('executionStats')
    const stats = explained.executionStats || {}
    reports.push({ name: example.name, returned: stats.nReturned, keysExamined: stats.totalKeysExamined, documentsExamined: stats.totalDocsExamined, milliseconds: stats.executionTimeMillis, indexes: [...indexNames(explained.queryPlanner?.winningPlan)], bounded: Number.isFinite(stats.totalDocsExamined) && stats.totalDocsExamined <= 5 + Math.max(stats.nReturned || 0, 1) * 20 })
  }
  return { queries: reports, unmeasured, allMeasuredQueriesBounded: reports.length > 0 && reports.every(report => report.bounded) }
}

async function main() {
  const [command = 'plan', ...args] = process.argv.slice(2)
  if (!['plan', 'apply', 'explain'].includes(command)) throw new Error('Usage: setup-indexes.cjs plan|apply|explain --host=cluster --database=name [--tenant=talio_company_name]')
  validateIndexes()
  if (command === 'plan') { console.log(JSON.stringify({ recordCollection: 'talio_records', plannedIndexes: RECORD_INDEXES.length + 1, maximumIndexes: 64, writes: false, prefix: PREFIX, indexes: RECORD_INDEXES }, null, 2)); return }
  const flags = Object.fromEntries(args.map(arg => { const match = /^--(host|database|tenant)=([^=]+)$/.exec(arg); if (!match) throw new Error('INVALID_TARGET_FLAG'); return [match[1], match[2]] }))
  const root = path.resolve(__dirname, '../..')
  const readEnv = file => fs.existsSync(path.join(root, file)) ? dotenv.parse(fs.readFileSync(path.join(root, file))) : {}
  const env = { ...readEnv('.env'), ...readEnv('.env.local'), ...process.env }
  assertTarget(env.MONGODB_URI, env.MONGODB_DATABASE, flags.host, flags.database)
  const { MongoClient } = require('mongodb')
  const client = new MongoClient(env.MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 15000, promoteBuffers: true })
  try {
    await client.connect()
    const db = client.db(env.MONGODB_DATABASE)
    const report = command === 'apply' ? await installRecordIndexes(db) : await explainHotQueries(db, { dataset: env.MONGODB_DATASET, databaseName: flags.tenant })
    console.log(JSON.stringify({ command, ...report }, null, 2))
    if (command === 'explain' && !report.allMeasuredQueriesBounded) process.exitCode = 1
  } finally { await client.close() }
}
if (require.main === module) main().catch(error => { console.error(JSON.stringify({ event: 'mongo-index-operation-failed', code: error.code || null, message: String(error.message).replace(/(?:mongodb(?:\+srv)?|https?):\/\/\S+/g, '[REDACTED_URI]') })); process.exitCode = 1 })
module.exports = { explainHotQueries, indexNames }
