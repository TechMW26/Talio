import { randomBytes } from 'node:crypto'
import { normalizeLeaveType } from './leaveData'
import { collectFirestorePages } from './platform/firestoreQueries.server'

export const LEAVE_TYPE_STORE_OPTIONS = {
  queryFields: { leavetypes: ['isActive', 'name'], leaves: ['leaveType'], leavebalances: ['leaveType'] },
  constraints: { leavetypes: [{ fields: ['name'] }, { fields: ['code'] }] },
}
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
export const assertLeaveTypeId = id => { if (!/^[a-f\d]{24}$/i.test(String(id))) fail('Invalid leave type ID') }
const manage = actor => { if (!['admin', 'hr'].includes(actor?.role)) fail('Access denied', 403) }
export function normalizeLeaveTypeInput(input, current) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid leave type')
  const next = current ? { ...current } : { carryForward: false, maxCarryForwardDays: 0, isPaid: true, requiresApproval: true, requiresDocument: false, minDaysNotice: 0, applicableGender: 'all', isActive: true, maxDaysPerYear: 0 }
  for (const key of ['name', 'code', 'description', 'applicableGender']) if (input[key] !== undefined) {
    if (typeof input[key] !== 'string') fail(`Invalid ${key}`)
    next[key] = input[key].trim()
  }
  if (!next.name || !next.code) fail('Leave type name and code are required')
  if (!['all', 'male', 'female'].includes(next.applicableGender)) fail('Invalid applicable gender')
  for (const key of ['carryForward', 'isPaid', 'requiresApproval', 'requiresDocument', 'isActive']) if (input[key] !== undefined) {
    if (typeof input[key] !== 'boolean') fail(`Invalid ${key}`)
    next[key] = input[key]
  }
  for (const [key, alias] of [['maxDaysPerYear', 'daysPerYear'], ['maxCarryForwardDays', 'maxCarryForward'], ['minDaysNotice', 'minNoticeDays']]) {
    const value = input[key] ?? input[alias]
    if (value !== undefined) {
      if (value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) fail(`Invalid ${key}`)
      next[key] = Number(value)
    }
    next[key] ??= Number(next[alias] || 0)
    next[alias] = next[key]
  }
  return next
}
export async function listLeaveTypes(database) {
  return (await collectFirestorePages(database, 'leavetypes', { filters: [{ field: 'isActive', operator: '==', value: true }], orderBy: [{ field: 'name' }] })).map(normalizeLeaveType)
}
export async function saveLeaveType(database, actor, input, id) {
  manage(actor)
  if (id) assertLeaveTypeId(id)
  return database.transaction(async tx => {
    const current = id ? await tx.get('leavetypes', id) : null
    if (id && !current) fail('Leave type not found', 404)
    const now = new Date(), next = { ...normalizeLeaveTypeInput(input, current), _id: id || randomBytes(12).toString('hex'), createdAt: current?.createdAt || now, updatedAt: now }
    if (current) await tx.replace('leavetypes', next)
    else await tx.create('leavetypes', next)
    return normalizeLeaveType(next)
  })
}
export async function deleteLeaveType(database, actor, id) {
  manage(actor); assertLeaveTypeId(id)
  return database.transaction(async tx => {
    if (!await tx.get('leavetypes', id)) fail('Leave type not found', 404)
    const filters = [{ field: 'leaveType', operator: '==', value: id }]
    const references = await Promise.all(['leaves', 'leavebalances'].map(collection => tx.list(collection, { filters, limit: 1 })))
    if (references.some(result => result.records.length)) fail('Leave type has requests or allocations; deactivate it instead', 409)
    await tx.delete('leavetypes', id)
  })
}
