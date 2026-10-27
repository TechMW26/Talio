import { createHash } from 'node:crypto'

const digest = value => createHash('sha256').update(value).digest('hex')
export async function createMiraReminder(database, user, fields, requestId, now = new Date()) {
  const owner = String(user._id || user.userId || '')
  if (!owner) throw Object.assign(new Error('Please sign in again.'), { status: 401 })
  if (requestId !== undefined && (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 200)) throw Object.assign(new Error('Invalid reminder request identity.'), { status: 400 })
  const payloadHash = digest(JSON.stringify([fields.message, new Date(fields.scheduledFor).toISOString(), fields.timezone]))
  const id = digest(`${database.databaseName}:${owner}:${requestId || payloadHash}`).slice(0, 24)
  return database.transaction(async tx => {
    const actor = await tx.get('users', owner)
    if (!actor || actor.isActive === false) throw Object.assign(new Error('Please sign in again.'), { status: 401 })
    const existing = await tx.get('schedulednotifications', id)
    if (existing) {
      if (existing.metadata?.owner !== owner || existing.metadata?.payloadHash !== payloadHash) throw Object.assign(new Error('This request identity was already used for a different reminder.'), { status: 409 })
      if (existing.status === 'cancelled') throw Object.assign(new Error('This reminder was cancelled. Start a new request to create it again.'), { status: 409 })
      return existing
    }
    const reminder = {
      _id: id, createdAt: now, updatedAt: now, title: 'MIRA reminder', message: fields.message,
      scheduledFor: new Date(fields.scheduledFor), timezone: fields.timezone,
      targetType: 'specific', targetUsers: [owner], recipients: [owner],
      createdBy: String(actor.employeeId?._id || actor.employeeId || owner), creatorUser: owner,
      createdByRole: actor.role, status: 'pending', url: '/dashboard',
      data: { type: 'mira-reminder', source: 'mira', scheduledFor: new Date(fields.scheduledFor).toISOString() },
      metadata: { source: 'mira', owner, payloadHash },
    }
    await tx.create('schedulednotifications', reminder)
    return reminder
  })
}
