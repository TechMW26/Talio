import { NextResponse } from 'next/server'
import { checkAndTriggerNotifications } from '@/lib/attendanceNotificationScheduler'
import { getCronAuthErrorResponse } from '@/lib/cronAuth'

export const dynamic = 'force-dynamic'

/**
 * GET - Check and trigger attendance notifications
 * This endpoint should be called every minute by a cron job or scheduler
 */
export async function GET(request) {
  try {
    const authError = getCronAuthErrorResponse(request)
    if (authError) return authError

    const result = await checkAndTriggerNotifications()

    return NextResponse.json({
      success: true,
      message: 'Notification check completed',
      data: result
    })
  } catch (error) {
    console.error('Notification scheduler error:', error)
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    )
  }
}
