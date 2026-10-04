const manifest = require('../../firestore.indexes.json')
const { coveredByManifest, inspectQuery, queryShape } = require('../../scripts/firestore-migration/audit-query-indexes.cjs')
const { projectNativeRecord } = require('../../lib/platform/searchProjection.cjs')
const subsets = fields => Array.from({ length: 2 ** fields.length }, (_, n) => fields.filter((_, i) => n & 2 ** i))
const shape = (collection, fields, orderBy = [], arrays = []) => ({ collection, filters: [...fields.map(field => ({ field, operator: '==' })), ...arrays.map(field => ({ field, operator: 'array-contains' }))], orderBy })
const shapes = []
// Keep this matrix aligned with listRecruitment's allowed filter/sort inputs.
for (const [collection, filters, sorts] of [
  ['jobpostings', ['status', 'department', 'employmentType'], ['createdAt', 'updatedAt', 'jobTitle', 'applicationDeadline']],
  ['candidates', ['jobPosting', 'stage', 'source'], ['createdAt', 'updatedAt', 'firstName', 'lastName', 'rating']],
]) for (const fields of subsets(filters)) {
  shapes.push(shape(collection, fields, [], ['searchGrams']))
  for (const field of sorts) for (const direction of ['asc', 'desc']) shapes.push(shape(collection, fields, [{ field, direction }]))
}
for (const fields of subsets(['jobPosting', 'candidate', 'status'])) for (const arrays of [[], ['interviewers']]) shapes.push(shape('interviews', fields, [{ field: 'scheduledDate', direction: 'asc' }], arrays))
for (const fields of subsets(['status', 'type', 'roomId'])) {
  shapes.push(shape('meetings', [...fields, 'organizer'], [{ field: 'scheduledStart', direction: 'desc' }]))
  shapes.push(shape('meetings', fields, [{ field: 'scheduledStart', direction: 'desc' }], ['inviteeEmployeeIds']))
}
for (const fields of subsets(['employee', 'month', 'year'])) shapes.push(shape('payrolls', fields, [{ field: 'year', direction: 'desc' }, { field: 'month', direction: 'desc' }]))
for (const fields of subsets(['employee', 'status'])) shapes.push(shape('expenses', fields, [{ field: 'createdAt', direction: 'desc' }]))
for (const [collection, filters, sorts] of [
  ['onboardingemails', ['status'], ['createdAt', 'recipientName', 'recipientEmail', 'employeeCode', 'sentAt', 'status']],
  ['projectemailnotificationlogs', ['status', 'triggerType', 'project', 'task'], ['createdAt', 'recipientEmail', 'recipientName', 'sentAt', 'status']],
]) for (const fields of subsets(filters)) {
  shapes.push(shape(collection, fields, [], ['searchGrams']))
  for (const field of sorts) for (const direction of ['asc', 'desc']) shapes.push(shape(collection, fields, [{ field, direction }]))
}
shapes.push(shape('pushsubscriptions', ['user'], [{ field: 'lastUsed', direction: 'desc' }]))
for (const fields of subsets(['type', 'severity', 'ip', 'email', 'userId'])) for (const direction of ['asc', 'desc']) shapes.push(shape('securityevents', fields, [{ field: 'createdAt', direction }]))
shapes.push(shape('ipblocks', [], [{ field: 'blockedAt', direction: 'desc' }]))
for (const fields of [['eventType'], ['project', 'type'], ['project', 'type', 'createdBy'], ['userId', 'consumed']]) shapes.push(shape('audit-and-timeline', fields, [{ field: 'createdAt', direction: 'desc' }]))
for (const [collection, equality, ranges] of [['projects', ['status'], ['endDate']], ['leaves', ['employee'], ['endDate']], ['performances', [], ['createdAt', 'status']], ['users', ['isActive'], ['profileCompletion.profileCompletionDeadline']], ['onboardingemails', ['queued'], ['scheduledFor']]]) shapes.push({ collection, filters: [...equality.map(field => ({ field, operator: '==' })), ...ranges.map(field => ({ field, operator: '>=' }))] })
for (const collection of ['leaves', 'attendancecorrections', 'expenses']) shapes.push({ collection, kind: 'count', filters: [{ field: 'status', operator: '==' }, { field: 'employee', operator: '!=' }] })
shapes.push(shape('tasks', ['project'], [{ field: 'order', direction: 'desc' }]), shape('departments', ['isActive'], [], ['departmentManagers']), shape('documents', ['employee'], [], ['searchGrams']), shape('policies', ['isActive'], [], ['searchGrams']))
test.each(shapes.map(query => [JSON.stringify(query), query]))('native dynamic query has an index: %s', (_, query) => {
  expect(coveredByManifest(query, manifest)).toBe(true)
})
test('manifest uses one array field, unique fields and explicit ascending cursor identity', () => {
  for (const index of manifest.indexes) {
    expect(index.fields.filter(field => field.arrayConfig).length).toBeLessThanOrEqual(1)
    expect(new Set(index.fields.map(field => field.fieldPath)).size).toBe(index.fields.length)
    expect(index.fields.at(-1)).toEqual({ fieldPath: '__name__', order: 'ASCENDING' })
  }
})
test('query audit rejects product disjunction overflow, not-in mixtures and multiple arrays', () => {
  expect(inspectQuery({ filters: [{ field: 'employee', operator: 'in', size: 30 }, { field: 'status', operator: 'in', size: 2 }] })).toContain('Disjunction limit exceeded: 60')
  expect(inspectQuery({ filters: [{ field: 'employee', operator: 'in', size: 30 }, { field: 'status', operator: '==' }, { field: 'startDate', operator: '<=' }, { field: 'endDate', operator: '>=' }] })).toContain('Query component limit exceeded: 240')
  expect(inspectQuery({ filters: [{ field: 'owner', operator: 'not-in', size: 2 }, { field: 'status', operator: 'in', size: 2 }] })).toContain('not-in mixed with disjunction')
  expect(inspectQuery({ filters: [{ field: 'employee', operator: 'in', size: 16 }, { field: 'searchGrams', operator: 'array-contains' }] })).toContain('Disjunction limit exceeded: 32')
  expect(inspectQuery({ filters: [{ field: 'members', operator: 'array-contains' }, { field: 'searchGrams', operator: 'array-contains' }] })).toContain('Multiple array membership filters')
  expect(queryShape({ filters: [{ field: 'startAt', operator: '>=' }, { field: 'endAt', operator: '>' }], orderBy: [{ field: 'startAt', direction: 'desc' }] }).ordering).toEqual([{ field: 'startAt', direction: 'desc' }, { field: 'endAt', direction: 'desc' }])
})
test.each([
  ['jobpostings', 'applicationDeadline'], ['candidates', 'rating'],
  ['onboardingemails', 'sentAt'], ['projectemailnotificationlogs', 'sentAt'],
])('optional %s sort projection retains incomplete records without overwriting values', (collection, field) => {
  const record = { _id: 'fixture', createdAt: new Date('2026-10-01T00:00:00Z'), status: 'pending' }
  const projected = projectNativeRecord(collection, record)
  expect(projected[field]).toBeNull()
  expect(projected).toMatchObject(record)
  expect(record).not.toHaveProperty(field)
  expect(projectNativeRecord(collection, projected)).toEqual(projected)
  expect(projectNativeRecord(collection, { ...record, [field]: 0 })[field]).toBe(0)
  expect(projectNativeRecord(collection, { ...record, [field]: record.createdAt })[field]).toBe(record.createdAt)
})
