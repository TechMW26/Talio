import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { ATTENDANCE_DATABASE_OPTIONS } from '@/lib/platform/firestoreAttendance.server'
import { syncHolidayAttendance } from '@/lib/platform/firestoreHolidayAttendance.server'
export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, ATTENDANCE_DATABASE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    if (!['admin', 'hr', 'owner', 'superadmin', 'super_admin'].includes(auth.user.role)) return NextResponse.json({ success: false, message: 'Insufficient permissions' }, { status: 403 })
    const result = await syncHolidayAttendance(auth.database)
    return NextResponse.json({ success: true, message: `Synced successfully. Created ${result.created} records, updated ${result.updated} records.`, ...result })
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message || 'Failed to sync holidays' }, { status: error.status || 500 })
  }
}
