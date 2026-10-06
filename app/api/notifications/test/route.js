import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { sendTestNotification, getNotificationStatus, UNIFIED_PUSH_STORE_OPTIONS } from '@/lib/unifiedPushService'

// POST - Test push notification (send test to authenticated user)
export async function POST(request) {
  try {
    // Authenticate and initialize tenant connection
    const auth = await getAuthAndDatabase(request, UNIFIED_PUSH_STORE_OPTIONS)
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: auth.message || 'Unauthorized' },
        { status: 401 }
      )
    }
    const { user } = auth

    // Get notification status for the user
    const status = await getNotificationStatus(user._id || user.userId, { database: auth.database })

    if (!status.hasAndroid && !status.hasWeb) {
      return NextResponse.json({
        success: false,
        message: 'No registered devices found. Please enable notifications first.',
        status
      }, { status: 400 })
    }

    // Send test notification
    const result = await sendTestNotification(user._id || user.userId, { database: auth.database })

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Test notification sent successfully',
        details: {
          android: result.android,
          web: result.web,
          totalSent: result.totalSent
        },
        deviceStatus: status
      })
    } else {
      return NextResponse.json({
        success: false,
        message: result.error || 'Failed to send test notification',
        hint: 'Make sure you have enabled notifications and have a registered device',
        deviceStatus: status
      })
    }
  } catch (error) {
    console.error('Test notification error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to send test notification', error: error.message },
      { status: 500 }
    )
  }
}

// GET - Get notification status for the user
export async function GET(request) {
  try {
    // Authenticate and initialize tenant connection
    const auth = await getAuthAndDatabase(request, UNIFIED_PUSH_STORE_OPTIONS)
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: auth.message || 'Unauthorized' },
        { status: 401 }
      )
    }
    const { user } = auth

    const status = await getNotificationStatus(user._id || user.userId, { database: auth.database })

    return NextResponse.json({
      success: true,
      status
    })
  } catch (error) {
    console.error('Get notification status error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to get notification status' },
      { status: 500 }
    )
  }
}
