import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { ATTENDANCE_DATABASE_OPTIONS } from '@/lib/platform/firestoreAttendance.server'
import { processPastDayIncompleteAttendance } from '@/lib/attendanceNotificationScheduler'

export const dynamic = 'force-dynamic'

/**
 * POST - Manually trigger fix for past-day incomplete attendance records
 * Only accessible by admin/hr roles
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndDatabase(request, ATTENDANCE_DATABASE_OPTIONS)
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, database } = auth

    // Check if user has admin/hr role
    if (!user || !['admin', 'hr'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Access denied. Admin or HR role required.' },
        { status: 403 }
      )
    }

    // Process incomplete attendance records
    const result = await processPastDayIncompleteAttendance(database)

    return NextResponse.json({
      success: true,
      message: result.processed > 0 
        ? `Fixed ${result.processed} incomplete attendance records. ${result.notified} users notified.`
        : 'No incomplete past-day attendance records found.',
      data: result
    })
  } catch (error) {
    console.error('Fix incomplete attendance error:', error)
    
    if (error.code === 'ERR_JWT_EXPIRED') {
      return NextResponse.json(
        { success: false, message: 'Session expired. Please log in again.' },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    )
  }
}
