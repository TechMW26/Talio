const COLLECTION = 'servicesettings'
const ID = 'productivity'

export async function getProductivitySettings(database) {
  const row = await database.get(COLLECTION, ID)
  return { screenshotsEnabled: row?.screenshotsEnabled !== false, updatedAt: row?.updatedAt || null }
}

export async function saveProductivitySettings(database, actor, enabled) {
  if (actor.role !== 'admin') throw Object.assign(new Error('Only administrators can change screenshot capture'), { status: 403 })
  if (typeof enabled !== 'boolean') throw Object.assign(new Error('screenshotsEnabled must be a boolean'), { status: 400 })
  const actorId = String(actor._id || actor.userId)
  return database.transaction(async tx => {
    const currentActor = await tx.get('users', actorId)
    if (!currentActor || currentActor.isActive === false || currentActor.role !== 'admin') throw Object.assign(new Error('Administrator access is required'), { status: 403 })
    const current = await tx.get(COLLECTION, ID)
    const row = { ...current, _id: ID, screenshotsEnabled: enabled, updatedAt: new Date(), updatedBy: actorId }
    if (current) await tx.replace(COLLECTION, row)
    else await tx.create(COLLECTION, row)
    return { screenshotsEnabled: enabled, updatedAt: row.updatedAt }
  })
}
