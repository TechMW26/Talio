import { randomBytes } from 'node:crypto'
import { normalizePermissionsShape, validatePermissionsShape } from '@/lib/permissions.shared'
import { SYSTEM_ROLE_DEFINITIONS } from '@/lib/systemRoles'

export const ROLE_STORE_OPTIONS = { queryFields: { users: ['roleId', 'isActive'], roles: ['name'] }, constraints: { roles: [{ fields: ['name'] }] } }
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const publicRole = role => ({ ...role, permissions: normalizePermissionsShape(role.permissions, role.isSystemRole ? SYSTEM_ROLE_DEFINITIONS[role.name]?.buildPermissions?.() : null) })

async function pages(database, collection, filters = []) {
  const rows = []; let cursor
  do {
    const page = await database.list(collection, { filters, limit: 100, ...(cursor ? { cursor } : {}) })
    rows.push(...page.records); cursor = page.nextCursor
  } while (cursor)
  return rows
}

export async function listNativeRoles(database, counts = false) {
  const roles = (await pages(database, 'roles')).filter(role => role.company && !role.deletedAt)
    .sort((a, b) => Number(b.isSystemRole) - Number(a.isSystemRole) || a.name.localeCompare(b.name))
  const result = []
  for (let offset = 0; offset < roles.length; offset += 10) result.push(...await Promise.all(roles.slice(offset, offset + 10).map(async role => ({ ...publicRole(role), ...(counts ? { userCount: await database.count('users', [{ field: 'roleId', operator: '==', value: role._id }, { field: 'isActive', operator: '==', value: true }]) } : {}) }))))
  return result
}

export async function getNativeRole(database, id) {
  const role = await database.get('roles', String(id))
  return role && !role.deletedAt ? publicRole(role) : null
}

export async function createNativeRole(database, actor, input) {
  if (typeof input?.name !== 'string' || typeof input.displayLabel !== 'string' || !input.displayLabel.trim()) fail('Name and display label are required')
  const name = input.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')
  if (!name || name.length > 100 || SYSTEM_ROLE_DEFINITIONS[name]) fail('Invalid or reserved role name')
  if (!input.permissions || typeof input.permissions !== 'object') fail('Permissions object is required')
  const permissions = normalizePermissionsShape(input.permissions)
  const validation = validatePermissionsShape(permissions)
  if (!validation.valid) fail('Invalid permissions shape')
  const company = (await database.list('companies', { limit: 1 })).records[0]
  if (!company) fail('Company not found', 404)
  if ((await database.list('roles', { filters: [{ field: 'name', operator: '==', value: name }], limit: 1 })).records.length) fail('A role with this name already exists', 409)
  const now = new Date()
  return database.create('roles', { _id: randomBytes(12).toString('hex'), name, displayLabel: input.displayLabel.trim(), description: typeof input.description === 'string' ? input.description.trim() : '', company: company._id, permissions, isSystemRole: false, createdBy: actor._id, createdAt: now, updatedAt: now })
}

export async function updateNativeRole(database, id, input) {
  for (const key of ['displayLabel', 'description']) if (input[key] !== undefined && typeof input[key] !== 'string') fail(`${key} must be a string`)
  const role = await database.mutate('roles', String(id), current => {
    if (current.deletedAt) fail('Role not found', 404)
    if (input.name && input.name !== current.name) fail('Role names cannot be changed')
    const next = { ...current, updatedAt: new Date() }
    if (input.displayLabel !== undefined) {
      if (!input.displayLabel.trim()) fail('Display label is required')
      next.displayLabel = input.displayLabel.trim()
    }
    if (input.description !== undefined) next.description = input.description.trim()
    if (input.permissions !== undefined) {
      if (!input.permissions || typeof input.permissions !== 'object') fail('Invalid permissions shape')
      next.permissions = normalizePermissionsShape(input.permissions, current.isSystemRole ? SYSTEM_ROLE_DEFINITIONS[current.name]?.buildPermissions?.() : null)
      if (!validatePermissionsShape(next.permissions).valid) fail('Invalid permissions shape')
    }
    return next
  })
  if (!role) fail('Role not found', 404)
  return publicRole(role)
}

export async function nativeRoleUsers(database, id) {
  return pages(database, 'users', [{ field: 'roleId', operator: '==', value: String(id) }])
}

export async function assignNativeRole(database, id, userIds) {
  if (!Array.isArray(userIds) || !userIds.length || userIds.length > 1000 || userIds.some(value => typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value))) fail('Provide 1 to 1000 valid user IDs')
  const assignedIds = []
  const ids = [...new Set(userIds)]
  for (let offset = 0; offset < ids.length; offset += 50) {
    const batch = await database.transaction(async tx => {
      const role = await tx.get('roles', String(id))
      if (!role || role.deletedAt) fail('Role not found', 404)
      const updated = []
      for (const userId of ids.slice(offset, offset + 50)) {
        const user = await tx.get('users', userId)
        if (!user?.isActive) continue
        await tx.replace('users', { ...user, roleId: role._id, permissionsCache: null, cacheUpdatedAt: null, updatedAt: new Date() })
        updated.push(userId)
      }
      return updated
    })
    assignedIds.push(...batch)
  }
  return assignedIds
}

export async function deleteNativeRole(database, id) {
  // Tombstone before unassignment so concurrent assignments cannot restore it.
  const role = await database.mutate('roles', String(id), current => {
    if (current.isSystemRole) fail('System roles cannot be deleted')
    return { ...current, deletedAt: current.deletedAt || new Date(), updatedAt: new Date() }
  })
  if (!role) fail('Role not found', 404)
  const users = await nativeRoleUsers(database, id)
  for (let offset = 0; offset < users.length; offset += 50) await database.transaction(async tx => {
    for (const user of users.slice(offset, offset + 50)) {
      const current = await tx.get('users', String(user._id))
      if (current?.roleId === String(id)) await tx.replace('users', { ...current, roleId: null, permissionsCache: null, cacheUpdatedAt: null, updatedAt: new Date() })
    }
  })
  return { role, userIds: users.map(user => String(user._id)) }
}
