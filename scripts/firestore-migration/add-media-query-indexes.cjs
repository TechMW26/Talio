'use strict'

// Deterministic index declarations for native media/productivity/history queries.
// This only rewrites the local manifest; it does not deploy indexes or data.
const fs = require('node:fs')
const manifestPath = 'firestore.indexes.json'
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const declarations = []
function add(equality, ordering = [], arrays = []) {
  const ordered = new Set(ordering.map(([field]) => field))
  declarations.push({ collectionGroup: 'records', queryScope: 'COLLECTION', fields: [
    ...equality.filter(field => !ordered.has(field)).sort().map(field => ({ fieldPath: `data.${field}`, order: 'ASCENDING' })),
    ...arrays.map(field => ({ fieldPath: `data.${field}`, arrayConfig: 'CONTAINS' })),
    ...ordering.map(([field, direction]) => ({ fieldPath: `data.${field}`, order: direction || 'ASCENDING' })),
    { fieldPath: '__name__', order: 'ASCENDING' },
  ] })
}
add(['userId', 'feature'], [['createdAt', 'DESCENDING']])
for (const fields of [['user', 'dateString'], ['user', 'sessionId'], ['user', 'sourceSessionId'], ['user', 'assignmentStatus'], ['wordpress.connectionId', 'wordpress.remoteId'], ['email', 'jobPosting']]) add(fields)
add([], [['updatedAt', 'ASCENDING'], ['_id', 'ASCENDING']])
for (const direction of ['ASCENDING', 'DESCENDING']) {
  for (const fields of [['user'], ['user', 'dateString'], ['user', 'captureType']]) add(fields, [['capturedAt', direction]])
  for (const fields of [['user'], ['employee'], ['user', 'dateString']]) add(fields, [['date', direction]])
}
add(['status'], [['date', 'ASCENDING']])
for (const field of ['assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager', 'department']) add(['status', field])
add(['status'], [], ['departments'])
for (const fields of [['project', 'user'], ['user', 'invitationStatus'], ['user', 'assignmentStatus']]) add(fields)
const signature = index => JSON.stringify(index)
const seen = new Set(manifest.indexes.map(signature))
let added = 0
for (const index of declarations) if (!seen.has(signature(index))) { manifest.indexes.push(index); seen.add(signature(index)); added++ }
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ added, total: manifest.indexes.length }))
