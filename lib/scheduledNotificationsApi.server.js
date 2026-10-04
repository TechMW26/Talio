import { NextResponse, after } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getCronAuthErrorResponse } from '@/lib/cronAuth'
import { SCHEDULE_OPTIONS, listNotificationSchedules, saveNotificationSchedule, stageDueNotification, dispatchNotificationDelivery, processNotificationSchedules } from '@/lib/scheduledNotifications.server'
export async function scheduledNotificationsApi(request, kind, method) {
  try {
    const auth = await getAuthAndDatabase(request, SCHEDULE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const database = auth.database, params = new URL(request.url).searchParams
    if (kind === 'process') { const denied = getCronAuthErrorResponse(request); if (denied) return denied; return NextResponse.json({ success: true, data: await processNotificationSchedules(database) }) }
    const collection = kind === 'recurring' ? 'recurringnotifications' : 'schedulednotifications'
    if (method === 'GET') return NextResponse.json({ success: true, data: await listNotificationSchedules(database, auth.user, collection, params) })
    const input = method === 'DELETE' ? {} : await request.json(), id = params.get('id') || (method === 'PATCH' ? input.id : null)
    if (['PUT', 'PATCH', 'DELETE'].includes(method) && !id) return NextResponse.json({ success: false, message: 'Notification ID is required' }, { status: 400 })
    const immediate = kind === 'send' && input.scheduleType !== 'scheduled'
    const data = await saveNotificationSchedule(database, auth.user, collection, input, { id, operation: method === 'DELETE' ? 'delete' : method === 'PATCH' ? 'toggle' : 'save', immediate })
    let delivery = null
    if (immediate) {
      delivery = await stageDueNotification(database, collection, data._id)
      if (delivery?.status === 'pending') after(async () => { try { await dispatchNotificationDelivery(database, delivery) } catch (error) { console.error('[Notification dispatch deferred]', error.message) } })
    }
    return NextResponse.json({ success: true, message: immediate ? 'Notification delivery queued' : method === 'DELETE' ? 'Notification cancelled' : method === 'PATCH' ? input.isActive ? 'Notification resumed' : 'Notification paused' : 'Notification saved', data: immediate ? { ...data, recipientCount: delivery?.recipientCount || 0, deliveryStatus: { database: 'queued', firebasePush: 'queued' } } : data }, { status: method === 'POST' ? 201 : 200 })
  } catch (error) { return NextResponse.json({ success: false, message: error.name === 'SyntaxError' ? 'Invalid request JSON' : error.status ? error.message : 'Could not process notification request' }, { status: error.name === 'SyntaxError' ? 400 : error.status || 500 }) }
}
