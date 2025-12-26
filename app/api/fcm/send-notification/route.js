/**
 * Send Notification API
 * Test endpoint to send push notifications via Firebase
 */

import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { jwtVerify } from 'jose'
import { sendPushToUsers } from '@/lib/pushNotification'

/**
 * POST /api/fcm/send-notification
 * Send a test notification to a user
 */
export async function POST(request) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const token = authHeader.substring(7)
    const secret = new TextEncoder().encode(process.env.JWT_SECRET)
    await jwtVerify(token, secret)

    // Parse request body
    const { userId, title, body, data = {}, imageUrl = null, deviceType = null } = await request.json()

    if (!title || !body) {
      return NextResponse.json(
        { success: false, message: 'Title and body are required' },
        { status: 400 }
      )
    }

    // Connect to database
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Notification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Notification } = models

    // Find target user (or use current user if no userId provided)
    const targetUser = userId
      ? await User.findById(userId)
      : await User.findOne({ email: session.user.email })

    if (!targetUser) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      )
    }

    console.log(`[FCM API] Sending notification to user ${targetUser._id}`)
    console.log(`[FCM API] User: ${targetUser.email}`)

    // Send notification via Firebase
    const result = await sendPushToUsers(
      [targetUser._id.toString()],
      { title, body },
      {
        data,
        url: data.url || '/dashboard',
        type: data.type || 'custom',
        models: { User, Notification }
      }
    )

    return NextResponse.json({
      success: result.success,
      message: result.message || (result.success ? 'Notification sent' : 'Failed to send notification'),
      user: {
        email: targetUser.email,
        name: targetUser.name
      }
    })

  } catch (error) {
    console.error('[FCM API] Send error:', error)
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    )
  }
}