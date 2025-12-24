import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import connectDB from '@/lib/mongodb'
import { sendTestNotification, getNotificationStatus } from '@/lib/unifiedPushService'

// POST - Test push notification (send test to authenticated user)
export async function POST(request) {
  try {
    await connectDB()

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
    const { payload: decoded } = await jwtVerify(token, secret)

    // Get notification status for the user
    const status = await getNotificationStatus(decoded.userId)

    if (!status.hasAndroid && !status.hasWeb) {
      return NextResponse.json({
        success: false,
        message: 'No registered devices found. Please enable notifications first.',
        status
      }, { status: 400 })
    }

    // Send test notification
    const result = await sendTestNotification(decoded.userId)

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
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const token = authHeader.substring(7)
    const secret = new TextEncoder().encode(process.env.JWT_SECRET)
    const { payload: decoded } = await jwtVerify(token, secret)

    await connectDB()

    const status = await getNotificationStatus(decoded.userId)

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
      } else if (response.status === 404) {
  errorMessage += 'App ID not found. Please verify your App ID.'
} else {
  errorMessage += result.errors ? result.errors.join(', ') : 'Unknown error occurred.'
}

return NextResponse.json({
  success: false,
  message: errorMessage,
  details: result
}, { status: 400 })
    }

// Success - credentials are valid
return NextResponse.json({
  success: true,
  message: 'OneSignal configuration is valid and working!',
  appInfo: {
    name: result.name,
    players: result.players,
    messageable_players: result.messageable_players,
    updated_at: result.updated_at
  }
})
  } catch (error) {
  console.error('Test config error:', error)
  return NextResponse.json({
    success: false,
    message: 'Failed to test configuration: ' + error.message
  }, { status: 500 })
}
}

