import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

/**
 * GET /api/actionable-notifications/[id]
 * Get a specific actionable notification
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params
    
    const auth = await getAuthAndModels(request, ['ActionableNotification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { ActionableNotification } = models

    const notification = await ActionableNotification.findOne({
      _id: id,
      user: user.userId
    }).populate('createdBy', 'firstName lastName avatar')

    if (!notification) {
      return NextResponse.json(
        { message: 'Notification not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      notification
    })
  } catch (error) {
    console.error('[GET /api/actionable-notifications/[id]] Error:', error)
    return NextResponse.json(
      { message: 'Failed to fetch notification', error: error.message },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/actionable-notifications/[id]
 * Update notification status (action taken or dismissed)
 */
export async function PATCH(request, { params }) {
  try {
    const { id } = await params
    
    const auth = await getAuthAndModels(request, ['ActionableNotification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { ActionableNotification } = models

    const body = await request.json()
    const { action, reason } = body

    if (!action) {
      return NextResponse.json(
        { message: 'Action is required' },
        { status: 400 }
      )
    }

    const notification = await ActionableNotification.findOne({
      _id: id,
      user: user.userId
    })

    if (!notification) {
      return NextResponse.json(
        { message: 'Notification not found' },
        { status: 404 }
      )
    }

    if (notification.status !== 'pending') {
      return NextResponse.json(
        { message: 'Notification has already been actioned' },
        { status: 400 }
      )
    }

    // Update notification status
    if (action === 'dismiss' || action === 'dismissed') {
      await notification.dismiss()
    } else {
      await notification.markAsActioned(action, reason)
    }

    // Emit socket event to update UI in real-time
    if (global.io) {
      global.io.to(`user:${user.userId}`).emit('actionable-notification-updated', {
        notificationId: id,
        status: notification.status,
        action,
        reason
      })
    }

    return NextResponse.json({
      success: true,
      notification,
      message: 'Notification updated successfully'
    })
  } catch (error) {
    console.error('[PATCH /api/actionable-notifications/[id]] Error:', error)
    return NextResponse.json(
      { message: 'Failed to update notification', error: error.message },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/actionable-notifications/[id]
 * Delete a notification (same as dismiss)
 */
export async function DELETE(request, { params }) {
  try {
    const { id } = await params
    
    const auth = await getAuthAndModels(request, ['ActionableNotification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { ActionableNotification } = models

    const notification = await ActionableNotification.findOne({
      _id: id,
      user: user.userId
    })

    if (!notification) {
      return NextResponse.json(
        { message: 'Notification not found' },
        { status: 404 }
      )
    }

    // Mark as dismissed rather than deleting (for audit purposes)
    await notification.dismiss()

    // Emit socket event
    if (global.io) {
      global.io.to(`user:${user.userId}`).emit('actionable-notification-removed', {
        notificationId: id
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Notification dismissed'
    })
  } catch (error) {
    console.error('[DELETE /api/actionable-notifications/[id]] Error:', error)
    return NextResponse.json(
      { message: 'Failed to dismiss notification', error: error.message },
      { status: 500 }
    )
  }
}
