import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

/**
 * GET /api/actionable-notifications
 * Get all pending actionable notifications for the current user
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['ActionableNotification', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { ActionableNotification } = models

    // Parse query params
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const status = searchParams.get('status') || 'pending'
    const limit = parseInt(searchParams.get('limit') || '50')

    // Build query
    const query = {
      user: user.userId,
      status
    }

    if (type) {
      query.type = type
    }

    const notifications = await ActionableNotification.find(query)
      .sort({ priority: -1, createdAt: -1 })
      .limit(limit)
      .populate('createdBy', 'firstName lastName avatar')
      .lean()

    return NextResponse.json({
      success: true,
      notifications,
      count: notifications.length
    })
  } catch (error) {
    console.error('[GET /api/actionable-notifications] Error:', error)
    return NextResponse.json(
      { message: 'Failed to fetch notifications', error: error.message },
      { status: 500 }
    )
  }
}

/**
 * POST /api/actionable-notifications
 * Create a new actionable notification
 * This is typically called by other API routes when events occur
 */
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['ActionableNotification', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { ActionableNotification } = models

    const body = await request.json()
    const {
      targetUserId,
      title,
      message,
      icon,
      type,
      priority,
      reference,
      actions,
      url,
      metadata,
      expiresAt,
      displaySettings
    } = body

    // Validate required fields
    if (!targetUserId || !title || !message || !type) {
      return NextResponse.json(
        { message: 'Missing required fields: targetUserId, title, message, type' },
        { status: 400 }
      )
    }

    // Create the notification
    const notification = await ActionableNotification.create({
      user: targetUserId,
      title,
      message,
      icon: icon || getDefaultIcon(type),
      type,
      priority: priority || 'medium',
      reference,
      actions: actions || getDefaultActions(type, body),
      url,
      metadata,
      createdBy: user.employeeId,
      expiresAt,
      displaySettings: displaySettings || { persistent: true, showInBell: true, playSound: true }
    })

    // Emit Socket.IO event to target user
    if (global.io) {
      global.io.to(`user:${targetUserId}`).emit('actionable-notification', {
        notification: notification.toObject()
      })
    }

    return NextResponse.json({
      success: true,
      notification,
      message: 'Notification created successfully'
    }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/actionable-notifications] Error:', error)
    return NextResponse.json(
      { message: 'Failed to create notification', error: error.message },
      { status: 500 }
    )
  }
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
