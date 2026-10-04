import { randomBytes } from 'node:crypto'
import { getFirestoreTenantDatabase } from './platform/firestoreApplication.server'
import { buildCachePattern, clearCachePattern } from './cache'

export const ACTIONABLE_STORE_OPTIONS = { queryFields: {
  actionablenotifications: ['user', 'status', 'type', 'priority', 'createdAt', 'snoozedUntil', 'reference.model', 'reference.id', 'metadata.reminderKey'],
  employees: ['status', 'lifecycle.probation.applicable', 'lifecycle.probation.status', 'lifecycle.probation.reviewDate'],
} }
export function getActionableDatabase(auth) {
  if (!auth?.tenant?.databaseName || !auth?.user) throw new Error('Verified tenant required')
  return getFirestoreTenantDatabase(auth.tenant.databaseName, ACTIONABLE_STORE_OPTIONS)
}
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
export const notificationUserId = user => String(user?._id || user?.id || user?.userId || '')
export const isNotificationExpired = (notification, now = new Date()) => Boolean(notification.expiresAt && new Date(notification.expiresAt) <= now)
export function normalizeActionableNotification(input) {
  if (!input?.user || !input.title || !input.message || !input.type) fail('Recipient, title, message, and type are required')
  if (!['project_invitation', 'task_assignment', 'meeting_invitation', 'leave_approval', 'expense_approval', 'document_approval', 'travel_approval', 'attendance_correction', 'helpdesk_assignment', 'announcement', 'probation_approval', 'generic'].includes(input.type)) fail('Invalid notification type')
  if (input.priority && !['low', 'medium', 'high', 'urgent'].includes(input.priority)) fail('Invalid notification priority')
  const now = new Date()
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
  if (expiresAt && Number.isNaN(expiresAt.getTime())) fail('Invalid notification expiry')
  const actions = (input.actions || []).map(action => {
    if (!action.id || !action.label) fail('Action ID and label required')
    if (action.endpoint && (!/^\/api\/[A-Za-z0-9_/?=&.%\-]+$/.test(action.endpoint) || action.endpoint.includes('..'))) fail('Action endpoint must be a local API path')
    if (action.method && !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(action.method)) fail('Invalid action method')
    return { variant: 'primary', method: 'POST', requiresConfirmation: false, requiresReason: false, ...action }
  })
  return { _id: randomBytes(12).toString('hex'), priority: 'medium', icon: '🔔', metadata: {}, ...input, user: String(input.user), expiresAt, snoozedUntil: input.snoozedUntil || null, actions, status: expiresAt && expiresAt <= now ? 'expired' : input.status || 'pending', displaySettings: { persistent: true, showInBell: true, playSound: true, dismissible: true, ...input.displaySettings }, createdAt: input.createdAt || now, updatedAt: now }
}
export async function invalidateActionableCache(database, userId) {
  await clearCachePattern(buildCachePattern({ tenantId: database.databaseName, userId: String(userId), namespace: 'actionable-notifications' })).catch(() => {})
}
export async function storeActionableNotification(database, input) {
  if (!database?.transaction || !database.databaseName) throw new Error('A verified tenant Firestore database is required')
  const notification = normalizeActionableNotification(input)
  await database.transaction(async tx => {
    if (!await tx.get('users', notification.user)) fail('Notification recipient not found', 404)
    await tx.create('actionablenotifications', notification)
  })
  await invalidateActionableCache(database, notification.user)
  return notification
}
export async function populateNotificationCreator(database, notification) {
  const creator = notification.createdBy && await database.get('employees', String(notification.createdBy))
  return { ...notification, createdBy: creator ? { _id: creator._id, firstName: creator.firstName, lastName: creator.lastName, avatar: creator.avatar } : null }
}
export async function listActionableNotifications(database, userId, { status = 'pending', type, limit = 50 } = {}) {
  if (!['pending', 'actioned', 'dismissed', 'expired'].includes(status) || !Number.isInteger(limit) || limit < 1 || limit > 100) fail('Invalid notification filters')
  const filters = [{ field: 'user', operator: '==', value: String(userId) }, { field: 'status', operator: '==', value: status }, ...(type ? [{ field: 'type', operator: '==', value: type }] : [])]
  const now = new Date(), notifications = []; let cursor
  do {
    const page = await database.list('actionablenotifications', { filters, orderBy: [{ field: 'priority', direction: 'desc' }, { field: 'createdAt', direction: 'desc' }], limit: 100, cursor })
    for (const record of page.records) {
      if (status === 'pending' && (isNotificationExpired(record, now) || record.snoozedUntil && new Date(record.snoozedUntil) > now)) continue
      notifications.push(record)
      if (notifications.length === limit) break
    }
    cursor = page.nextCursor
  } while (notifications.length < limit && cursor)
  let nextReminderAt = null
  if (status === 'pending') {
    cursor = null
    do {
      const page = await database.list('actionablenotifications', { filters: [...filters, { field: 'snoozedUntil', operator: '>', value: now }], orderBy: [{ field: 'snoozedUntil' }], limit: 100, cursor })
      nextReminderAt = page.records.find(record => !isNotificationExpired(record, now))?.snoozedUntil || null
      cursor = page.nextCursor
    } while (!nextReminderAt && cursor)
  }
  return { success: true, notifications: await Promise.all(notifications.map(record => populateNotificationCreator(database, record))), nextReminderAt, count: notifications.length }
}
export async function updateActionableNotification(database, userId, id, { action, reason, allowAlreadyActioned = false }) {
  const record = await database.transaction(async tx => {
    const current = await tx.get('actionablenotifications', id)
    if (!current || String(current.user) !== String(userId)) fail('Notification not found', 404)
    if (allowAlreadyActioned && current.status === 'actioned') return current
    if (current.status !== 'pending' || isNotificationExpired(current)) fail('This notification is no longer pending.', 409)
    const now = new Date()
    if (action === 'snooze') {
      const changed = { ...current, snoozedUntil: new Date(now.getTime() + 3600000), updatedAt: now }
      await tx.replace('actionablenotifications', changed)
      return changed
    }
    if (['dismiss', 'dismissed'].includes(action) && current.displaySettings?.dismissible === false) fail('This notification requires a decision and cannot be dismissed', 409)
    if (!action) fail('Action is required')
    const changed = { ...current, status: ['dismiss', 'dismissed'].includes(action) ? 'dismissed' : 'actioned', actionTaken: { action: ['dismiss', 'dismissed'].includes(action) ? 'dismissed' : action, reason: reason ? String(reason).slice(0, 2000) : null, takenAt: now }, updatedAt: now }
    await tx.replace('actionablenotifications', changed)
    return changed
  })
  await invalidateActionableCache(database, userId)
  global.io?.to(`user:${userId}`).emit('actionable-notification-updated', { notificationId: id, status: record.status, action, reason, snoozedUntil: record.snoozedUntil })
  return record
}
