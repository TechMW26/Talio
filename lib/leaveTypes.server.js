import { randomBytes } from 'node:crypto'
import { normalizeLeaveType } from './leaveData'
import { DEFAULT_LEAVE_TYPES } from './leavePolicy'
import { collectFirestorePages, readFirestoreReferences } from './platform/firestoreQueries.server'

export const LEAVE_TYPE_STORE_OPTIONS = {
  queryFields: { leavetypes: ['isActive', 'name'], leaves: ['leaveType'], leavebalances: ['leaveType'] },
  constraints: { leavetypes: [{ fields: ['name'] }, { fields: ['code'] }] },
}
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
export const assertLeaveTypeId = id => { if (!/^[a-f\d]{24}$/i.test(String(id))) fail('Invalid leave type ID') }

function typeKey(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/** Resolve leave types whether a request stored an ID, code, or display name. */
export function buildLeaveTypeIndex(types = []) {
  const byId = new Map(), byCode = new Map(), byName = new Map()
  for (const type of types) {
    if (!type) continue
    const id = String(type._id || '')
    if (id) byId.set(id, type)
    const code = typeKey(type.code)
    if (code) byCode.set(code, type)
    const name = typeKey(type.name)
    if (name) byName.set(name, type)
  }
  return {
    types,
    resolve(value) {
      if (value && typeof value === 'object') {
        return byId.get(String(value._id || ''))
          || byCode.get(typeKey(value.code))
          || byName.get(typeKey(value.name))
          || null
      }
      const key = typeKey(value)
      if (!key) return null
      return byId.get(String(value)) || byCode.get(key) || byName.get(key) || null
    },
  }
}

export async function loadLeaveTypes(database, { includeInactive = true } = {}) {
  const filters = includeInactive ? [] : [{ field: 'isActive', operator: '==', value: true }]
  return (await collectFirestorePages(database, 'leavetypes', { filters }))
    .map(normalizeLeaveType)
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))
}

/** Resolve request references (ID, code, or name) without always scanning types. */
export async function resolveLeaveTypes(database, references = []) {
  const unique = [...new Set(references.filter(Boolean).map(reference => String(reference)))]
  if (!unique.length) return { types: [], resolve: () => null }
  const found = await readFirestoreReferences(database, 'leavetypes', unique)
  const byReference = new Map([...found].map(([id, type]) => [id, type]))
  let index = buildLeaveTypeIndex([...found.values()])
  if (unique.some(reference => !byReference.has(reference))) {
    const merged = new Map([...found.values()].map(type => [String(type._id), type]))
    for (const type of await loadLeaveTypes(database)) merged.set(String(type._id), type)
    index = buildLeaveTypeIndex([...merged.values()])
  }
  return {
    types: index.types,
    resolve(reference) {
      if (!reference) return null
      return byReference.get(String(reference)) || index.resolve(reference)
    },
  }
}

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
/**
 * Ensure a canonical leave type exists for a tenant.
 * Runs inside the caller's transaction and is safe to retry.
 */
export async function ensureLeaveType(store, code) {
  const wanted = String(code || '').trim().toUpperCase()
  const definition = DEFAULT_LEAVE_TYPES.find(type => type.code === wanted)
  if (!definition) fail('Unsupported leave type', 400)
  const existing = (await loadLeaveTypes(store)).find(type => String(type.code || '').toUpperCase() === wanted)
  if (existing) return existing
  const now = new Date()
  const next = {
    ...definition,
    description: '',
    applicableGender: 'all',
    requiresApproval: true,
    minDaysNotice: 0,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    _id: randomBytes(12).toString('hex'),
  }
  await store.create('leavetypes', next)
  return normalizeLeaveType(next)
}

export async function deleteLeaveType(database, actor, id) {
  manage(actor); assertLeaveTypeId(id)
  return database.transaction(async tx => {
    const current = await tx.get('leavetypes', id)
    if (!current) fail('Leave type not found', 404)
    const values = [id, current.code].filter(Boolean)
    const filters = [{ field: 'leaveType', operator: 'in', value: values }]
    const references = await Promise.all(['leaves', 'leavebalances'].map(collection => tx.list(collection, { filters, limit: 1 })))
    if (references.some(result => result.records.length)) fail('Leave type has requests or allocations; deactivate it instead', 409)
    await tx.delete('leavetypes', id)
  })
}
