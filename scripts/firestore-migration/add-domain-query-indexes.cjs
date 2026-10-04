'use strict'
// Idempotent declaration of native domain query shapes. This only edits the
// local manifest; deploying indexes requires a separately authorized operation.
const fs = require('node:fs')
const path = require('node:path')
const file = path.resolve(__dirname, '../../firestore.indexes.json')
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
const previous = manifest.indexes.length
// Collection-scope ASC/array single-field indexes already exist automatically.
// Keep the non-default DESC field + ASC __name__ indexes, which are required.
manifest.indexes = manifest.indexes.filter(row => !(row.collectionGroup === 'records' && row.queryScope === 'COLLECTION' && row.fields.length === 2 && row.fields[1].fieldPath === '__name__' && row.fields[1].order === 'ASCENDING' && (row.fields[0].order === 'ASCENDING' || row.fields[0].arrayConfig === 'CONTAINS')))
const seen = new Set(manifest.indexes.map(row => JSON.stringify(row)))
function add(fields) {
  if (fields.length === 1 && !fields[0].endsWith(':DESCENDING')) return
  const row = { collectionGroup: 'records', queryScope: 'COLLECTION', fields: [...fields.map(field => {
    const [name, mode = 'ASCENDING'] = field.split(':')
    return { fieldPath: `data.${name}`, ...(mode === 'CONTAINS' ? { arrayConfig: 'CONTAINS' } : { order: mode }) }
  }), { fieldPath: '__name__', order: 'ASCENDING' }] }
  const key = JSON.stringify(row); if (!seen.has(key)) { manifest.indexes.push(row); seen.add(key) }
}
const subsets = fields => Array.from({ length: 2 ** fields.length }, (_, n) => fields.filter((_, i) => n & 2 ** i))
for (const fields of subsets(['assignedTo', 'status'])) add([...fields, 'createdAt:DESCENDING'])
for (const scope of [[], ['createdBy'], ['assignedTo']]) for (const fields of subsets(['status', 'priority'])) add([...scope, ...fields, 'createdAt:DESCENDING'])
for (const fields of [[], ['type']]) add(['isActive', ...fields, 'date'])
add(['category', 'createdAt:DESCENDING'])
for (const fields of [[], ['priority']]) { add(['status', ...fields, 'createdAt:DESCENDING']); add(['status', ...fields, 'searchGrams:CONTAINS']) }
for (const fields of [[], ['status'], ['reviewPeriod']]) add(['employee', ...fields, 'createdAt:DESCENDING'])
add(['employee', 'createdAt'])
for (const scope of [['employee'], ['employee', 'status'], ['requestedByUser'], ['requestedByEmployee'], ['approverUserIds:CONTAINS']]) add([...scope, 'updatedAt:DESCENDING'])
add(['employee', 'reviewPeriod', 'status'])
for (const fields of [['user', 'assignedAt'], ['user', 'assignmentStatus'], ['employee', 'date'], ['isActive', 'role'], ['isActive', 'employeeId'], ['members:CONTAINS', 'isActive'], ['isDepartmentHead', 'headOfDepartments:CONTAINS']]) add(fields)
for (const scope of [[], ['createdBy'], ['targetDepartment']]) for (const status of [[], ['status']]) for (const direction of ['ASCENDING', 'DESCENDING']) add([...scope, ...status, `scheduledFor:${direction}`])
for (const scope of [[], ['createdBy'], ['targetDepartment']]) for (const active of [[], ['isActive']]) add([...scope, ...active, 'createdAt:DESCENDING'])
for (const fields of [['isActive', 'nextScheduledAt'], ['status', 'createdAt'], ['status', 'scheduledEnd', 'scheduledStart'], ['isActive', 'serviceStatus', 'isSetupComplete'], ['isActive', 'head'], ['isActive', 'heads:CONTAINS'], ['department', 'status']]) add(fields)
for (const fields of [[], ['read']]) add(['user', ...fields, 'createdAt:DESCENDING'])
add(['user', 'read'])
// Independent exercised-query and dynamic-sort audit (emulator does not enforce
// composite indexes). DESC values followed by ASC document IDs need explicit
// indexes even when no equality filter is supplied.
add(['project', 'order:DESCENDING'])
add(['isActive', 'departmentManagers:CONTAINS'])
add(['employee', 'searchGrams:CONTAINS'])
add(['isActive', 'searchGrams:CONTAINS'])
for (const field of ['updatedAt', 'jobTitle', 'applicationDeadline', 'firstName', 'lastName', 'rating']) add([`${field}:DESCENDING`])
// Email-history filters and user-selectable sorts are combinable in the UI.
// Equality fields also used for ordering must occur only once in the index.
for (const [filters, sorts] of [
  [['status'], ['createdAt', 'recipientName', 'recipientEmail', 'employeeCode', 'sentAt', 'status']],
  [['status', 'triggerType', 'project', 'task'], ['createdAt', 'recipientEmail', 'recipientName', 'sentAt', 'status']],
]) for (const fields of subsets(filters)) {
  add([...fields, 'searchGrams:CONTAINS'])
  for (const sort of sorts) for (const direction of ['ASCENDING', 'DESCENDING']) add([...fields.filter(field => field !== sort), `${sort}:${direction}`])
}
add(['user', 'lastUsed:DESCENDING'])
for (const fields of subsets(['type', 'severity', 'ip', 'email', 'userId'])) for (const direction of ['ASCENDING', 'DESCENDING']) add([...fields, `createdAt:${direction}`])
add(['blockedAt:DESCENDING'])
for (const fields of [['eventType'], ['project', 'type'], ['project', 'type', 'createdBy'], ['userId', 'consumed']]) add([...fields, 'createdAt:DESCENDING'])
for (const fields of [['status', 'endDate'], ['employee', 'endDate'], ['createdAt', 'status'], ['isActive', 'profileCompletion.profileCompletionDeadline'], ['queued', 'scheduledFor']]) add(fields)
// Attendance/health query shapes requested by the media agent.
for (const fields of [['employee', 'status'], ['attendance', 'status'], ['employee', 'outOfPremisesRequest.status'], ['employee', 'createdAt:DESCENDING'], ['employee', 'status', 'createdAt'], ['employee', 'type', 'createdAt:DESCENDING']]) add(fields)
for (const field of ['birthdayMonthDay', 'joiningMonthDay']) add(['status', field])
for (const field of ['hostUserId', 'guestUserId']) for (const order of ['createdAt', 'updatedAt']) { add([field, 'status', `${order}:DESCENDING`]); add([field, `${order}:DESCENDING`]) }
add(['sender', 'createdAt:DESCENDING']); add(['receiverUserIds:CONTAINS', 'createdAt:DESCENDING'])
for (const scope of ['isPublic', 'submittedBy']) for (const fields of subsets(['status', 'isPinned'])) { add([scope, ...fields, 'createdAt:DESCENDING']); add([scope, ...fields, 'searchGrams:CONTAINS']) }
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Native domain indexes: ${previous} -> ${manifest.indexes.length}`)
