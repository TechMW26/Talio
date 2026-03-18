import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'

/**
 * POST /api/actionable-notifications/[id]/action
 * Execute an action on an actionable notification
 * This handles calling the action's endpoint and updating the notification status
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params
    
    // Validate ObjectId format
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { message: 'Invalid notification ID format' },
        { status: 400 }
      )
    }
    
    const auth = await getAuthAndModels(request, ['ActionableNotification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }

    const { user, models, tenant } = auth
    const { ActionableNotification } = models

    const body = await request.json()
    const { actionId, reason, skipEndpoint } = body

    if (!actionId) {
      return NextResponse.json(
        { message: 'actionId is required' },
        { status: 400 }
      )
    }

    // Find the notification
    const currentUserId = user?._id || user?.userId
    const notification = await ActionableNotification.findOne({
      _id: id,
      user: currentUserId
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

    // Find the action
    const action = notification.actions.find(a => a.id === actionId)
    if (!action) {
      return NextResponse.json(
        { message: 'Action not found' },
        { status: 400 }
      )
    }

    // Handle dismiss action
    if (actionId === 'dismiss' || actionId === 'dismissed') {
      await notification.dismiss()
      
      if (global.io) {
        global.io.to(`user:${user.userId}`).emit('actionable-notification-updated', {
          notificationId: id,
          status: 'dismissed',
          action: actionId
        })
      }

      return NextResponse.json({
        success: true,
        message: 'Notification dismissed'
      })
    }

    // Handle view action (just navigate, don't call endpoint)
    if (actionId === 'view') {
      await notification.markAsActioned('viewed')
      
      if (global.io) {
        global.io.to(`user:${user.userId}`).emit('actionable-notification-updated', {
          notificationId: id,
          status: 'actioned',
          action: actionId
        })
      }

      return NextResponse.json({
        success: true,
        message: 'Notification marked as viewed',
        url: notification.url
      })
    }

    // If action has an endpoint, call it server-side (unless client already handled it)
    let actionResult = null
    if (action.endpoint && !skipEndpoint) {
      try {
        // Build the full URL
        const baseUrl = new URL(request.url).origin
        const fullUrl = `${baseUrl}${action.endpoint}`

        // Build payload
        const payload = { ...action.payload }
        if (reason && action.requiresReason) {
          payload.reason = reason
          payload.rejectionReason = reason
        }

        // Get token from request
        const token = request.headers.get('authorization')?.split(' ')[1] || 
                      request.cookies.get('token')?.value

        // Make the API call
        const response = await fetch(fullUrl, {
          method: action.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        })

        const result = await response.json()

        if (!response.ok) {
          console.error('[Action endpoint failed]', {
            endpoint: action.endpoint,
            status: response.status,
            result
          })
          
          return NextResponse.json({
            success: false,
            message: result.message || 'Action failed',
            error: result
          }, { status: response.status })
        }

        actionResult = result
      } catch (endpointError) {
        console.error('[Action endpoint error]', endpointError)
        return NextResponse.json({
          success: false,
          message: 'Failed to execute action',
          error: endpointError.message
        }, { status: 500 })
      }
    }

    // Mark notification as actioned
    await notification.markAsActioned(actionId, reason)

    // Emit socket event
    if (global.io) {
      global.io.to(`user:${user.userId}`).emit('actionable-notification-updated', {
        notificationId: id,
        status: 'actioned',
        action: actionId,
        result: actionResult
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Action executed successfully',
      notification,
      actionResult
    })
  } catch (error) {
    console.error('[POST /api/actionable-notifications/[id]/action] Error:', error)
    return NextResponse.json(
      { message: 'Failed to execute action', error: error.message },
      { status: 500 }
    )
  }
}
