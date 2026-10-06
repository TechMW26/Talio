import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getActionableDatabase, notificationUserId, updateActionableNotification, isNotificationExpired } from '@/lib/actionableNotificationStore.server'

export async function POST(request, { params }) {
  try {
    const { id } = await params
    if (!/^[a-f\d]{24}$/i.test(id)) return NextResponse.json({ message: 'Invalid notification ID format' }, { status: 400 })
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    const database = await getActionableDatabase(auth), userId = notificationUserId(auth.user)
    const body = await request.json(), { actionId, reason, skipEndpoint } = body
    const notification = await database.get('actionablenotifications', id)
    if (!notification || String(notification.user) !== userId) return NextResponse.json({ message: 'Notification not found' }, { status: 404 })
    if (notification.status !== 'pending' || isNotificationExpired(notification)) return NextResponse.json({ message: 'Notification has already been actioned or expired' }, { status: 409 })
    const action = (notification.actions || []).find(item => item.id === actionId)
    if (!action) return NextResponse.json({ message: 'Action not found' }, { status: 400 })
    if (action.requiresReason && !String(reason || '').trim()) return NextResponse.json({ message: 'A reason is required' }, { status: 400 })
    if (['view', 'dismiss', 'dismissed'].includes(actionId)) {
      const changed = await updateActionableNotification(database, userId, id, { action: actionId === 'view' ? 'viewed' : actionId, reason })
      return NextResponse.json({ success: true, notification: changed, message: actionId === 'view' ? 'Notification marked as viewed' : 'Notification dismissed', ...(actionId === 'view' ? { url: notification.url } : {}) })
    }
    let actionResult = null
    if (action.endpoint && !skipEndpoint) {
      if (!/^\/api\/[A-Za-z0-9_/?=&.%\-]+$/.test(action.endpoint) || action.endpoint.includes('..') || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(action.method || 'POST')) return NextResponse.json({ message: 'Invalid action endpoint' }, { status: 400 })
      const executionId = randomUUID()
      const claimed = await database.transaction(async tx => {
        const current = await tx.get('actionablenotifications', id)
        if (!current || current.status !== 'pending' || current.execution?.status === 'running' || current.execution?.status === 'unknown') return false
        await tx.replace('actionablenotifications', { ...current, execution: { id: executionId, action: actionId, status: 'running', startedAt: new Date() }, updatedAt: new Date() })
        return true
      })
      if (!claimed) return NextResponse.json({ message: 'Action is already processing or its outcome needs review. Refresh before retrying.' }, { status: 409 })
      try {
        const payload = { ...action.payload, ...(reason && action.requiresReason ? { reason, rejectionReason: reason } : {}) }
        const token = request.headers.get('authorization')?.split(' ')[1] || request.cookies?.get('token')?.value
        const method = action.method || 'POST'
        const response = await fetch(new URL(action.endpoint, new URL(request.url).origin), { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(request.headers.get('cookie') ? { Cookie: request.headers.get('cookie') } : {}) }, ...(method !== 'GET' ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(30000), redirect: 'error' })
        actionResult = await response.json()
        if (!response.ok) {
          await database.mutate('actionablenotifications', id, current => current.execution?.id === executionId ? { ...current, execution: null, updatedAt: new Date() } : current)
          return NextResponse.json({ success: false, message: actionResult.message || 'Action failed' }, { status: response.status })
        }
        await database.mutate('actionablenotifications', id, current => current.execution?.id === executionId ? { ...current, execution: { ...current.execution, status: 'completed', completedAt: new Date() } } : current)
      } catch (error) {
        await database.mutate('actionablenotifications', id, current => current.execution?.id === executionId ? { ...current, execution: { ...current.execution, status: 'unknown' }, updatedAt: new Date() } : current).catch(() => {})
        return NextResponse.json({ success: false, message: 'The action outcome could not be confirmed. Check the underlying request before retrying.' }, { status: 502 })
      }
    }
    const changed = await updateActionableNotification(database, userId, id, { action: actionId, reason, allowAlreadyActioned: true })
    return NextResponse.json({ success: true, message: 'Action executed successfully', notification: changed, actionResult })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Failed to execute action' }, { status: error.status || 500 }) }
}
