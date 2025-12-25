import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { jwtVerify } from 'jose'
import { processPastDayIncompleteAttendance } from '@/lib/attendanceNotificationScheduler'

export const dynamic = 'force-dynamic'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key')

/**
 * POST - Manually trigger fix for past-day incomplete attendance records
 * Only accessible by admin/hr roles
 */
export async function POST(request) {
  try {
    // Verify authorization
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const token = authHeader.split(' ')[1]
    const { payload } = await jwtVerify(token, JWT_SECRET)

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User } = models

    // Check if user has admin/hr role
    if (!user || !['admin', 'hr'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Access denied. Admin or HR role required.' },
        { status: 403 }
      )
    }

    // Process incomplete attendance records
    const result = await processPastDayIncompleteAttendance()

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
