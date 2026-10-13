const COLLECTION = 'servicesettings'
const ID = 'mira'
const ALL_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

export async function getMiraSettings(database) {
  const row = await database.get(COLLECTION, ID)
  return { enabled: row?.enabled !== false, allowedLevels: row?.allowedLevels ?? ALL_LEVELS,
    configured: Array.isArray(row?.allowedLevels), agent: row?.agent || null, updatedAt: row?.updatedAt || null }
}

export async function getMiraAccess(database, user, suppliedSettings) {
  const settings = suppliedSettings || await getMiraSettings(database)
  if (!settings.enabled) return { allowed: false, level: null }
  // Keep legacy access until an administrator explicitly selects levels.
  if (!settings.configured) return { allowed: true, level: null }
  const employeeId = user.employeeId?._id || user.employeeId
  const employee = employeeId ? await database.get('employees', String(employeeId)) : null
  if (employee?.isActive === false) return { allowed: false, level: null }
  const designationId = employee?.designation?._id || employee?.designation
  const designation = designationId ? await database.get('designations', String(designationId)) : null
  // Employee-specific seniority is what the org chart and hierarchy use. A
  // title's default (e.g. Manager/L6) must not override an employee's saved L9.
  const level = Number(employee?.designationLevel ?? designation?.level)
  return { allowed: ALL_LEVELS.includes(level) && settings.allowedLevels.includes(level), level: ALL_LEVELS.includes(level) ? level : null }
}

export function isMiraExecutionPath(path) {
  return path.startsWith('/api/ai/mira-') || (path.startsWith('/api/mira/') && !['/api/mira/access', '/api/mira/agent', '/api/mira/preferences'].includes(path))
}

export async function updateMiraSettings(database, actor, changes) {
  if (actor.role !== 'admin') throw Object.assign(new Error('Administrator access is required'), { status: 403 })
  if ('enabled' in changes && (typeof changes.enabled !== 'boolean' || !Array.isArray(changes.allowedLevels) ||
    changes.allowedLevels.some(level => !ALL_LEVELS.includes(level)) || new Set(changes.allowedLevels).size !== changes.allowedLevels.length)) {
    throw Object.assign(new Error('Select valid levels L1–L9 and an on/off value'), { status: 400 })
  }
  const actorId = String(actor._id || actor.userId)
  return database.transaction(async tx => {
    const fresh = await tx.get('users', actorId)
    if (!fresh?.isActive || fresh.role !== 'admin') throw Object.assign(new Error('Administrator access is required'), { status: 403 })
    const previous = await tx.get(COLLECTION, ID)
    const row = { ...previous, ...changes, _id: ID, updatedBy: actorId, updatedAt: new Date() }
    if (previous) await tx.replace(COLLECTION, row)
    else await tx.create(COLLECTION, row)
    return row
  })
}
