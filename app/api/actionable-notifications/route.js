import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { ensureProbationReviewReminder } from '@/lib/hrms/probationReminder.server'
import { isFeatureEnabled } from '@/lib/planFeatures'
import { getActionableDatabase, listActionableNotifications, storeActionableNotification, notificationUserId } from '@/lib/actionableNotificationStore.server'

export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    const database = await getActionableDatabase(auth)
    if (isFeatureEnabled(auth.companyFeatures, 'probation')) await ensureProbationReviewReminder({ database, user: auth.user }).catch(error => console.error('[Probation reminder]', error.message))
    const params = new URL(request.url).searchParams
    const result = await listActionableNotifications(database, notificationUserId(auth.user), { status: params.get('status') || 'pending', type: params.get('type'), limit: Number(params.get('limit') || 50) })
    return NextResponse.json(result)
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Failed to fetch notifications' }, { status: error.status || 500 }) }
}

export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    if (!['admin', 'hr', 'superadmin', 'super_admin'].includes(auth.user.role)) return NextResponse.json({ message: 'HR or admin access is required to create notifications' }, { status: 403 })
    const database = await getActionableDatabase(auth)
    const body = await request.json()
    if (!/^[a-f\d]{24}$/i.test(body.targetUserId)) return NextResponse.json({ message: 'Invalid targetUserId format' }, { status: 400 })
    if (body.reference?.id && !/^[a-f\d]{24}$/i.test(body.reference.id)) return NextResponse.json({ message: 'Invalid reference.id format' }, { status: 400 })
    const notification = await storeActionableNotification(database, { user: body.targetUserId, title: body.title, message: body.message, icon: body.icon || getDefaultIcon(body.type), type: body.type, priority: body.priority || 'medium', reference: body.reference, actions: body.actions || getDefaultActions(body.type, body), url: body.url, metadata: body.metadata, expiresAt: body.expiresAt, displaySettings: body.displaySettings, createdBy: auth.user.employeeId })
    global.io?.to(`user:${body.targetUserId}`).emit('actionable-notification', { notification })
    return NextResponse.json({ success: true, notification, message: 'Notification created successfully' }, { status: 201 })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Failed to create notification' }, { status: error.status || 500 }) }
}

/**
 * Get default icon based on notification type
 */
function getDefaultIcon(type) {
  const icons = {
    project_invitation: '📊',
    task_assignment: '✅',
    meeting_invitation: '📅',
    leave_approval: '🏖️',
    expense_approval: '💰',
    document_approval: '📄',
    travel_approval: '✈️',
    attendance_correction: '⏰',
    helpdesk_assignment: '🎫',
    announcement: '📢',
    generic: '🔔'
  }
  return icons[type] || '🔔'
}

/**
 * Get default actions based on notification type
 */
function getDefaultActions(type, body) {
  const { reference, metadata } = body

  switch (type) {
    case 'project_invitation':
      return [
        {
          id: 'accept',
          label: 'Accept',
          variant: 'success',
          endpoint: `/api/projects/${reference?.id}/members/respond`,
          method: 'POST',
          payload: { action: 'accept' }
        },
        {
          id: 'reject',
          label: 'Decline',
          variant: 'danger',
          endpoint: `/api/projects/${reference?.id}/members/respond`,
          method: 'POST',
          payload: { action: 'reject' },
          requiresReason: true,
          reasonPrompt: 'Reason for declining (optional)'
        }
      ]

    case 'task_assignment':
      return [
        {
          id: 'accept',
          label: 'Accept',
          variant: 'success',
          endpoint: `/api/projects/${metadata?.projectId}/tasks/${reference?.id}/respond`,
          method: 'POST',
          payload: { action: 'accept' }
        },
        {
          id: 'reject',
          label: 'Decline',
          variant: 'danger',
          endpoint: `/api/projects/${metadata?.projectId}/tasks/${reference?.id}/respond`,
          method: 'POST',
          payload: { action: 'reject' },
          requiresReason: true,
          reasonPrompt: 'Why are you declining this task?'
        }
      ]

    case 'meeting_invitation':
      return [
        {
          id: 'accept',
          label: 'Accept',
          variant: 'success',
          endpoint: `/api/meetings/${reference?.id}/respond`,
          method: 'POST',
          payload: { response: 'accepted' }
        },
        {
          id: 'tentative',
          label: 'Maybe',
          variant: 'warning',
          endpoint: `/api/meetings/${reference?.id}/respond`,
          method: 'POST',
          payload: { response: 'tentative' }
        },
        {
          id: 'decline',
          label: 'Decline',
          variant: 'danger',
          endpoint: `/api/meetings/${reference?.id}/respond`,
          method: 'POST',
          payload: { response: 'declined' }
        }
      ]

    case 'leave_approval':
      return [
        {
          id: 'approve',
          label: 'Approve',
          variant: 'success',
          endpoint: `/api/leave/${reference?.id}`,
          method: 'PATCH',
          payload: { status: 'approved' }
        },
        {
          id: 'reject',
          label: 'Reject',
          variant: 'danger',
          endpoint: `/api/leave/${reference?.id}`,
          method: 'PATCH',
          payload: { status: 'rejected' },
          requiresReason: true,
          reasonPrompt: 'Reason for rejection'
        }
      ]

    case 'expense_approval':
      return [
        {
          id: 'approve',
          label: 'Approve',
          variant: 'success',
          endpoint: `/api/expenses/${reference?.id}/approve`,
          method: 'POST',
          payload: { action: 'approve' }
        },
        {
          id: 'reject',
          label: 'Reject',
          variant: 'danger',
          endpoint: `/api/expenses/${reference?.id}/approve`,
          method: 'POST',
          payload: { action: 'reject' },
          requiresReason: true,
          reasonPrompt: 'Reason for rejection'
        }
      ]

    case 'announcement':
      return [
        {
          id: 'view',
          label: 'View',
          variant: 'primary'
        },
        {
          id: 'dismiss',
          label: 'Dismiss',
          variant: 'secondary'
        }
      ]

    default:
      return [
        {
          id: 'view',
          label: 'View',
          variant: 'primary'
        },
        {
          id: 'dismiss',
          label: 'Dismiss',
          variant: 'secondary'
        }
      ]
  }
}
