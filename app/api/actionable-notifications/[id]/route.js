import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getActionableDatabase, notificationUserId, populateNotificationCreator, updateActionableNotification } from '@/lib/actionableNotificationStore.server'

async function handle(request, { params }) {
  try {
    const { id } = await params
    if (!/^[a-f\d]{24}$/i.test(id)) return NextResponse.json({ message: 'Invalid notification ID format' }, { status: 400 })
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    const database = await getActionableDatabase(auth), userId = notificationUserId(auth.user)
    if (request.method === 'GET') {
      const notification = await database.get('actionablenotifications', id)
      if (!notification || String(notification.user) !== userId) return NextResponse.json({ message: 'Notification not found' }, { status: 404 })
      return NextResponse.json({ success: true, notification: await populateNotificationCreator(database, notification) })
    }
    let input = { action: 'dismiss' }
    if (request.method !== 'DELETE') {
      try { input = await request.json() } catch { return NextResponse.json({ message: 'Invalid JSON request body' }, { status: 400 }) }
    }
    const notification = await updateActionableNotification(database, userId, id, input)
    return NextResponse.json({ success: true, notification, ...(input.action === 'snooze' ? { snoozedUntil: notification.snoozedUntil } : {}), message: input.action === 'snooze' ? 'We will remind you in 1 hour.' : 'Notification updated successfully' })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Failed to update notification' }, { status: error.status || 500 }) }
}
export const GET = handle
export const PATCH = handle
export const DELETE = handle
