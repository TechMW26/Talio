import { randomBytes } from 'node:crypto'
import { LEVEL_NAMES, inferLevelFromTitle } from './designationLevels'
import { collectFirestorePages } from './platform/firestoreQueries.server'

export const DESIGNATION_STORE_OPTIONS = {
  queryFields: { designations: ['isActive', 'title', 'code'], employees: ['designation'] },
  constraints: { designations: [{ fields: ['title'] }, { fields: ['code'] }] },
}
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
export function assertDesignationManager(user) {
  if (!['admin', 'super_admin', 'hr'].includes(user?.role)) fail('You do not have permission to manage designations', 403)
}
export function assertDesignationId(id) {
  if (!/^[a-f\d]{24}$/i.test(id)) fail('Invalid designation ID')
}
function normalize(input, current) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid designation details')
  const fields = {}
  for (const key of ['title', 'description', 'levelName']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string') fail(`Invalid designation ${key}`)
      fields[key] = input[key].trim()
    }
  }
  const title = fields.title ?? current?.title
  if (!title) fail('Designation title is required')
  if (!current || input.level !== undefined || input.title !== undefined) {
    const level = Number(input.level)
    fields.level = Number.isInteger(level) && level >= 1 && level <= 9 ? level : inferLevelFromTitle(title)
    fields.levelName = fields.levelName || LEVEL_NAMES[fields.level]
  }
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== 'boolean') fail('Invalid designation status')
    fields.isActive = input.isActive
  }
  return fields
}
export async function listDesignations(database) {
  return collectFirestorePages(database, 'designations', { filters: [{ field: 'isActive', operator: '==', value: true }], orderBy: [{ field: 'title' }] })
}
export async function saveDesignation(database, actor, input, id) {
  assertDesignationManager(actor)
  if (id) {
    assertDesignationId(id)
    const result = await database.mutate('designations', id, current => ({ ...current, ...normalize(input, current), updatedAt: new Date() }))
    if (!result) fail('Designation not found', 404)
    return result
  }
  const fields = normalize(input)
  const explicitCode = input.code !== undefined && input.code !== ''
  if (explicitCode && typeof input.code !== 'string') fail('Invalid designation code')
  const base = explicitCode ? input.code.trim() : fields.title.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'DESIG'
  if (!base) fail('Designation code is required')
  const now = new Date(), record = { _id: randomBytes(12).toString('hex'), isActive: true, ...fields, createdAt: now, updatedAt: now }
  // Unique claims make code allocation safe even when concurrent creators
  // observe the same available suffix. Never retry a duplicate title.
  for (let attempt = 1; attempt <= 100; attempt++) {
    const code = attempt === 1 ? base : `${base}-${attempt}`
    try { return await database.create('designations', { ...record, code }) } catch (error) {
      if (error.code !== 'ALREADY_EXISTS' || explicitCode) throw error
      const title = await database.list('designations', { filters: [{ field: 'title', operator: '==', value: fields.title }], limit: 1 })
      if (title.records.length) fail('Designation title is already in use', 409)
    }
  }
  fail('Unable to allocate a unique designation code', 409)
}
export async function deleteDesignation(database, actor, id) {
  assertDesignationManager(actor)
  assertDesignationId(id)
  return database.transaction(async tx => {
    const current = await tx.get('designations', id)
    if (!current) fail('Designation not found', 404)
    const assigned = await tx.list('employees', { filters: [{ field: 'designation', operator: '==', value: id }], limit: 1 })
    if (assigned.records.length) fail('This designation is assigned to employees; deactivate it instead', 409)
    await tx.delete('designations', id)
  })
}
