import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { ATTENDANCE_DATABASE_OPTIONS, attendanceError } from '@/lib/platform/firestoreAttendance.server'
import { getProductivityVisibility, queryProductivityByIds } from '@/lib/platform/firestoreProductivityView.server'
import { getAttendanceDayRange } from '@/lib/attendanceAutoCheckout'
import { getDateKeyInTimezone, getTimezone, parseDateTimeInTimezone } from '@/lib/timezone'
import { EMPLOYED_STATUSES } from '@/lib/leaveAllocation.server'
export const dynamic = 'force-dynamic'
export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, ATTENDANCE_DATABASE_OPTIONS)
    if (!auth.success) throw attendanceError(auth.message, 401)
    const { database, user } = auth
    const { employees: visible } = await getProductivityVisibility(database, user)
    const employees = visible.filter(e=>EMPLOYED_STATUSES.includes(e.status))
    if (!employees.length) return NextResponse.json({ success: true, data: [] })
    const settings = (await database.list('companysettings', { limit: 1 })).records[0] || {}, timezone = getTimezone(settings.timezone), now = new Date()
    const range = getAttendanceDayRange(now, timezone)
    const officeStart = parseDateTimeInTimezone(getDateKeyInTimezone(now, timezone) + 'T' + (settings.checkInTime || '09:00') + ':00', timezone)
    const absentThresholdMinutes = settings.absentThresholdMinutes ?? 60, isPastThreshold = now >= new Date(officeStart.getTime() + absentThresholdMinutes * 60000)
    const [records, leaves] = await Promise.all([
      queryProductivityByIds(database, 'attendances', 'employee', employees.map(e=>e._id), [{ field: 'date', operator: '>=', value: range.start }, { field: 'date', operator: '<=', value: range.end }]),
      queryProductivityByIds(database, 'leaves', 'employee', employees.map(e=>e._id), [{ field: 'status', operator: '==', value: 'approved' }, { field: 'startDate', operator: '<=', value: range.end }, { field: 'endDate', operator: '>=', value: range.start }]),
    ])
    const map = new Map(records.map(r=>[r.employee,r])), onLeave = new Set(leaves.filter(l=>!l.workFromHome && l.requestType !== 'early_leave').map(l=>l.employee))
    const data = employees.map(e => {
      const record = map.get(e._id)
      const status = onLeave.has(e._id) ? 'on-leave' : record?.status || (now < officeStart ? 'not-started' : isPastThreshold ? 'absent' : 'not-checked-in')
      return { _id: e._id, firstName: e.firstName, lastName: e.lastName, profilePicture: e.profilePicture, status, checkIn: record?.checkIn || null, checkOut: record?.checkOut || null, workHours: record?.workHours || 0 }
    })
    return NextResponse.json({ success: true, data, meta: { total: data.length, present: data.filter(e=>['present','in-progress'].includes(e.status)).length, absent: data.filter(e=>e.status==='absent').length, onLeave: data.filter(e=>e.status==='on-leave').length, notCheckedIn: data.filter(e=>e.status==='not-checked-in').length, isPastThreshold, absentThresholdMinutes } })
  } catch(error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }) }
}
