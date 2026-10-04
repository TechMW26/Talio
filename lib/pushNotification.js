import { randomBytes } from 'node:crypto'
import { sendNotificationToUser } from './firebaseNotification'
import { readFirestoreReferences } from './platform/firestoreQueries.server'

function requestOptions(titleOrMessage, body, options) {
  return typeof titleOrMessage === 'object' && titleOrMessage !== null
    ? { title: titleOrMessage.title, message: titleOrMessage.body, opts: body || {} }
    : { title: titleOrMessage, message: body, opts: options || {} }
}
async function deliver(user, title, message, opts) {
  const { database, data = {}, url = '/dashboard', icon = '/icons/icon-192x192.png', type = 'system', eventType, clickAction } = opts
  const now = new Date(), record = { _id: randomBytes(12).toString('hex'), user: String(user._id), title, message, type, url: clickAction || url, icon, read: false, createdAt: now, updatedAt: now, deliveryStatus: { fcm: { sent: false }, socketIO: { sent: false } } }
  // Persist before contacting FCM so an unavailable provider cannot lose the in-app notification.
  if (!opts.skipPersistence) await database.create('notifications', record)
  if (process.env.TALIO_LOCAL_ACCEPTANCE === '1') return { success: false, skipped: true, notificationId: record._id, reason: 'Local acceptance: external push disabled' }
  const result = await sendNotificationToUser(user, { title, body: message }, { ...data, url: clickAction || url, type, icon, ...(eventType ? { eventType } : {}) })
  if (!opts.skipPersistence) await database.mutate('notifications', record._id, current => current ? { ...current, deliveryStatus: { ...current.deliveryStatus, fcm: { sent: Boolean(result?.success), sentAt: result?.success ? new Date() : null } }, updatedAt: new Date() } : null)
  return result
}
export async function sendPushToUser(userId, titleOrMessage, body, options = {}) {
  const { title, message, opts } = requestOptions(titleOrMessage, body, options)
  if (!opts.database?.databaseName) throw new Error('A native tenant database is required for push notifications')
  const user = await opts.database.get('users', String(userId))
  if (!user) return { success: false, message: 'User not found', successCount: 0, failureCount: 1 }
  return deliver(user, title, message, opts)
}
export async function sendPushToUsers(userIds, titleOrMessage, body, options = {}) {
  const { title, message, opts } = requestOptions(titleOrMessage, body, options)
  if (!opts.database?.databaseName) throw new Error('A native tenant database is required for push notifications')
  const users = await readFirestoreReferences(opts.database, 'users', userIds)
  let successCount = 0, failureCount = new Set(userIds.map(String)).size - users.size
  for (const user of users.values()) {
    const result = await deliver(user, title, message, opts)
    if (result?.success) successCount++; else failureCount++
  }
  return { success: successCount > 0, successCount, failureCount, totalUsers: users.size }
}
