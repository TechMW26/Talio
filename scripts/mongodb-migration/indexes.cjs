'use strict'

// One shared records bank, with tenant/dataset equality at the start of every
// query index. Partial indexes omit records that do not contain the indexed
// fields; a screenshot must not consume an entry in every employee index.
const PREFIX = { dataset: 1, databaseName: 1, collectionName: 1 }
const field = name => `envelope.data.${name}`
function queryIndex(name, fields, directions = {}) {
  return {
    name: `talio_${name}_v1`,
    key: { ...PREFIX, ...Object.fromEntries(fields.map(name => [field(name), directions[name] || 1])), recordKey: 1 },
    partialFilterExpression: Object.fromEntries(fields.map(name => [field(name), { $exists: true }])),
  }
}

// Deliberately below MongoDB's 64-index limit. These are high-frequency paths
// read on session authorization, dashboards, attendance and capture feeds, not
// an index for every possible optional application field.
const RECORD_INDEXES = [
  { name: 'dataset_1_databaseName_1_collectionName_1_recordKey_1', key: { ...PREFIX, recordKey: 1 }, unique: true },
  queryIndex('email', ['email']),
  queryIndex('session_token', ['tokenId']),
  queryIndex('user_id', ['userId']),
  queryIndex('employee_id', ['employeeId']),
  queryIndex('employee_code', ['employeeCode']),
  queryIndex('registry_slug', ['slug']),
  queryIndex('registry_database', ['databaseName']),
  queryIndex('registry_setup_code', ['setupCode.code']),
  queryIndex('user', ['user']),
  queryIndex('employee', ['employee']),
  queryIndex('active', ['isActive']),
  queryIndex('status', ['status']),
  queryIndex('role_active', ['role', 'isActive']),
  queryIndex('directory_order', ['status', 'firstName', 'lastName']),
  queryIndex('employee_date', ['employee', 'date']),
  queryIndex('date', ['date']),
  queryIndex('user_day', ['user', 'dateString']),
  queryIndex('employee_day', ['employee', 'dateString']),
  queryIndex('day', ['dateString']),
  queryIndex('user_capture_time', ['user', 'capturedAt']),
  queryIndex('capture_time', ['capturedAt']),
  queryIndex('upload_date', ['uploadDate']),
  queryIndex('created', ['createdAt'], { createdAt: -1 }),
  queryIndex('user_created', ['user', 'createdAt'], { createdAt: -1 }),
  queryIndex('employee_created', ['employee', 'createdAt'], { createdAt: -1 }),
  queryIndex('status_created', ['status', 'createdAt'], { createdAt: -1 }),
  queryIndex('department', ['department']),
  queryIndex('project', ['project']),
  queryIndex('project_status', ['project', 'status']),
  queryIndex('project_order', ['project', 'order'], { order: -1 }),
  queryIndex('task', ['task']),
]

const same = (first, second) => JSON.stringify(first) === JSON.stringify(second)
function validateIndexes(indexes = RECORD_INDEXES) {
  if (indexes.length + 1 > 64) throw new Error('MONGODB_INDEX_LIMIT_EXCEEDED')
  const names = new Set()
  for (const index of indexes) {
    if (names.has(index.name) || !index.name || !same(Object.fromEntries(Object.entries(index.key).slice(0, 3)), PREFIX) || index.key.recordKey !== 1) throw new Error('INVALID_SCOPED_MONGODB_INDEX')
    names.add(index.name)
    if (Object.values(index.key).some(direction => direction !== 1 && direction !== -1)) throw new Error('INVALID_MONGODB_INDEX_DIRECTION')
  }
  return indexes
}

async function installRecordIndexes(db, indexes = RECORD_INDEXES) {
  validateIndexes(indexes)
  const records = db.collection('talio_records')
  let existing
  try { existing = await records.listIndexes().toArray() } catch (error) {
    if (error.code !== 26) throw error
    existing = []
  }
  const missing = []
  for (const wanted of indexes) {
    const named = existing.find(index => index.name === wanted.name)
    if (named && (!same(named.key, wanted.key) || Boolean(named.unique) !== Boolean(wanted.unique) || !same(named.partialFilterExpression, wanted.partialFilterExpression))) throw new Error('MONGODB_INDEX_DEFINITION_CONFLICT')
    const equivalent = existing.find(index => same(index.key, wanted.key) && Boolean(index.unique) === Boolean(wanted.unique) && same(index.partialFilterExpression, wanted.partialFilterExpression))
    if (!equivalent) missing.push(wanted)
  }
  const existingCount = existing.length || 1 // MongoDB creates _id_ implicitly.
  if (existingCount + missing.length > 64) throw new Error('MONGODB_EXISTING_INDEX_LIMIT_EXCEEDED')
  // Sequential creation bounds cluster load; repeat calls are a no-op and no
  // existing index is ever dropped or silently replaced.
  for (const { key, ...options } of missing) await records.createIndex(key, options)
  return { existingIndexes: existingCount, createdIndexes: missing.length, finalIndexes: existingCount + missing.length, droppedIndexes: 0 }
}

module.exports = { PREFIX, RECORD_INDEXES, queryIndex, validateIndexes, installRecordIndexes }
