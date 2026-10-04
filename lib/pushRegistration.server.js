import { createHash, randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from './auth'
import { collectFirestorePages } from './platform/firestoreQueries.server'
export const PUSH_REGISTRATION_OPTIONS = { queryFields: { pushsubscriptions: ['user', 'endpoint', 'lastUsed', 'isActive'] } }
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
export const pushHandler = fn => async request => { try { return await fn(request) } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }) } }
export async function pushAuth(request) { const auth = await getAuthAndDatabase(request, PUSH_REGISTRATION_OPTIONS); if (!auth.success) fail(auth.message, 401); return auth }
const userId = user => String(user._id || user.userId)
const validateToken = token => { if (typeof token !== 'string' || !token.trim() || token.length > 4096 || token.startsWith('ExponentPushToken')) fail('A valid native FCM token is required') }
export async function mutateUserPush(database, actor, action, input) {
  const token = input.fcmToken || input.token
  if (action !== 'preferences') validateToken(token)
  if (action === 'preferences' && (!input.preferences || Array.isArray(input.preferences) || typeof input.preferences !== 'object' || Object.values(input.preferences).some(value => typeof value !== 'boolean'))) fail('Notification preferences must contain boolean values')
  const rawPlatform = input.deviceInfo?.platform || input.deviceInfo?.device || input.device || 'android'
  if (typeof rawPlatform !== 'string' || rawPlatform.length > 80 || (input.deviceInfo && (Array.isArray(input.deviceInfo) || typeof input.deviceInfo !== 'object' || JSON.stringify(input.deviceInfo).length > 8000))) fail('Invalid device information')
  return database.mutate('users', userId(actor), row => {
    if (!row || row.isActive === false) fail('User unavailable', 403)
    const now = new Date(), tokens = row.fcmTokens || []
    if (action === 'preferences') return { ...row, notificationPreferences: { ...row.notificationPreferences, ...input.preferences }, updatedAt: now }
    if (action === 'remove') return { ...row, fcmTokens: tokens.filter(item => item.token !== token), updatedAt: now }
    const existing = tokens.find(item => item.token === token), device = rawPlatform === 'web' ? 'web' : rawPlatform.startsWith('ios') ? 'ios' : 'android'
    if (!existing && tokens.length >= 100) fail('Too many registered devices; remove an old device first', 409)
    return { ...row, fcmTokens: [...tokens.filter(item => item.token !== token), { ...existing, token, device, platform: rawPlatform, deviceInfo: { ...existing?.deviceInfo, ...input.deviceInfo }, createdAt: existing?.createdAt || now, lastUsed: now }], updatedAt: now }
  })
}
export const registerFcmToken = pushHandler(async request => { const auth = await pushAuth(request), row = await mutateUserPush(auth.database, auth.user, 'register', await request.json()); return NextResponse.json({ success: true, message: 'FCM token registered successfully', tokenCount: row.fcmTokens.length, platform: row.fcmTokens.at(-1).platform }) })
export const removeFcmToken = pushHandler(async request => { const auth = await pushAuth(request); await mutateUserPush(auth.database, auth.user, 'remove', await request.json()); return NextResponse.json({ success: true, message: 'FCM token removed successfully' }) })
export const updatePushPreferences = pushHandler(async request => { const auth = await pushAuth(request), row = await mutateUserPush(auth.database, auth.user, 'preferences', await request.json()); return NextResponse.json({ success: true, message: 'Notification preferences updated', preferences: row.notificationPreferences }) })
export function validatePushEndpoint(endpoint) {
  let url; try { url = new URL(endpoint) } catch { fail('Invalid subscription endpoint') }
  const providers = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'notify.windows.com', 'push.apple.com']
  if (url.protocol !== 'https:' || url.username || url.password || url.port || endpoint.length > 4096 || !providers.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) fail('Unsupported push service endpoint')
}
export async function upsertPushSubscription(database, actor, input, remove = false) {
  const endpoint = input.subscription?.endpoint || input.endpoint
  validatePushEndpoint(endpoint)
  if (!remove && (!input.subscription?.keys?.p256dh || !input.subscription?.keys?.auth || JSON.stringify(input.subscription.keys).length > 4096 || JSON.stringify(input.deviceInfo || {}).length > 8000)) fail('Invalid subscription keys or device information')
  return database.transaction(async tx => {
    const user = await tx.get('users', userId(actor))
    if (!user || user.isActive === false) fail('User unavailable', 403)
    const existing = await tx.list('pushsubscriptions', { filters: [{ field: 'user', operator: '==', value: userId(actor) }, { field: 'endpoint', operator: '==', value: endpoint }], limit: 100, requireComplete: true })
    const records = existing.records
    if (remove && !records.length) fail('Subscription not found', 404)
    const now = new Date(), record = records[0] || { _id: createHash('sha256').update(`${userId(actor)}:${endpoint}`).digest('hex').slice(0, 24), user: userId(actor), endpoint, createdAt: now }
    if (remove) { for (const item of records) await tx.replace('pushsubscriptions', { ...item, isActive: false, revokedAt: now }); return record }
    const saved = { ...record, keys: { p256dh: input.subscription.keys.p256dh, auth: input.subscription.keys.auth }, deviceInfo: input.deviceInfo || {}, isActive: true, lastUsed: now }
    if (records.length) await tx.replace('pushsubscriptions', saved); else await tx.create('pushsubscriptions', saved)
    for (const duplicate of records.slice(1)) await tx.replace('pushsubscriptions', { ...duplicate, isActive: false, revokedAt: now })
    return saved
  })
}
export const savePushSubscription = pushHandler(async request => { const auth = await pushAuth(request), data = await upsertPushSubscription(auth.database, auth.user, await request.json()); return NextResponse.json({ success: true, message: 'Push subscription saved successfully', data }) })
export const listPushSubscriptions = pushHandler(async request => { const auth = await pushAuth(request), data = (await collectFirestorePages(auth.database, 'pushsubscriptions', { filters: [{ field: 'user', operator: '==', value: userId(auth.user) }], orderBy: [{ field: 'lastUsed', direction: 'desc' }] })).filter(row => row.isActive !== false); return NextResponse.json({ success: true, data }) })
export const removePushSubscription = pushHandler(async request => { const auth = await pushAuth(request); await upsertPushSubscription(auth.database, auth.user, await request.json(), true); return NextResponse.json({ success: true, message: 'Push subscription removed successfully' }) })
