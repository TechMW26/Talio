'use strict'
// Mechanical, local-only index manifest merge. Never deploys cloud resources.
const fs = require('node:fs')
const manifest = JSON.parse(fs.readFileSync('firestore.indexes.json', 'utf8'))
const declarations = []
function add(equality = [], ordering = [], arrays = []) {
  const ordered = new Set(ordering.map(([field]) => field))
  declarations.push({ collectionGroup: 'records', queryScope: 'COLLECTION', fields: [
    ...equality.filter(field => !ordered.has(field)).sort().map(field => ({ fieldPath: `data.${field}`, order: 'ASCENDING' })),
    ...arrays.map(field => ({ fieldPath: `data.${field}`, arrayConfig: 'CONTAINS' })),
    ...ordering.map(([field, direction]) => ({ fieldPath: `data.${field}`, order: direction || 'ASCENDING' })),
    { fieldPath: '__name__', order: 'ASCENDING' },
  ] })
}
add([], [['lastMessageAt', 'DESCENDING']], ['participants'])
add(['isGroup'], [], ['participants'])
for (const fields of [['user', 'month'], ['user', 'category'], ['isActive', 'suspensionReason'], ['isActive', 'employeeId'], ['isActive', 'head'], ['department', 'status'], ['project', 'user'], ['user', 'assignmentStatus'], ['employee', 'year']]) add(fields)
add(['isActive'], [], ['heads'])
add(['targetUser', 'status'], [['expiresAt', 'ASCENDING']])
for (const field of ['targetUser', 'requestedByUser']) add([field], [['requestedAt', 'DESCENDING']])
add(['user'], [['lastMessageAt', 'DESCENDING']])
add(['employeeId'], [['lastHeartbeat', 'ASCENDING']])
add(['employee'], [['date', 'ASCENDING']])
add(['employee'], [['date', 'DESCENDING']])
add(['status'], [['date', 'ASCENDING']])
// Sidebar approval counts exclude the current employee with !=, which makes
// employee the inequality-order suffix rather than an equality-prefix field.
add(['status'], [['employee', 'ASCENDING']])
for (const field of ['employee', 'status', 'requestedBy']) add([field], [['createdAt', 'DESCENDING']])
for (const field of ['projectHead', 'createdBy']) add([field], [['updatedAt', 'DESCENDING']])
add([], [['updatedAt', 'DESCENDING']], ['projectHeads'])
for (const direction of ['ASCENDING', 'DESCENDING']) {
  add(['organizer'], [['scheduledStart', direction]])
  add([], [['scheduledStart', direction]], ['inviteeEmployeeIds'])
}
for (const field of ['assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager']) add([field, 'status'])
const seen = new Set(manifest.indexes.map(index => JSON.stringify(index)))
let added = 0
for (const index of declarations) if (!seen.has(JSON.stringify(index))) { manifest.indexes.push(index); seen.add(JSON.stringify(index)); added++ }
fs.writeFileSync('firestore.indexes.json', JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ added, total: manifest.indexes.length }))
