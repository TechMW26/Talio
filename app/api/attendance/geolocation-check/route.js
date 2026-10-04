import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { ATTENDANCE_DATABASE_OPTIONS, attendanceId, attendanceError, populateAttendanceEmployee } from '@/lib/platform/firestoreAttendance.server'
import { sendPushToUser } from '@/lib/pushNotification'
import { evaluateEmployeeGeofence, isValidCoordinate } from '@/lib/geofencing'
import { getAttendanceDayRange } from '@/lib/attendanceAutoCheckout'
import { getTimezone } from '@/lib/timezone'
import { finishAttendance } from '@/lib/attendanceNotificationScheduler'
export const dynamic = 'force-dynamic'
export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, ATTENDANCE_DATABASE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    const { database, user } = auth
    const { latitude, longitude, accuracy, locationSource = 'gps' } = await request.json()
    if (!isValidCoordinate(latitude, longitude)) throw attendanceError('Valid location coordinates required')
    const employee = await populateAttendanceEmployee(database, await database.get('employees', attendanceId(user.employeeId)))
    if (!employee) throw attendanceError('Employee not found', 404)
    const global = (await database.list('companysettings', { limit: 1 })).records[0] || {}
    const settings = { ...global, ...employee.company?.workingHours, geofence: employee.company?.geofence || global.geofence, breakTimings: employee.company?.breakTimings || global.breakTimings || [], timezone: getTimezone(employee.company?.timezone || global.timezone) }
    const range = getAttendanceDayRange(new Date(), settings.timezone)
    const records = (await database.list('attendances', { filters: [{ field: 'employee', operator: '==', value: employee._id }, { field: 'date', operator: '>=', value: range.start }, { field: 'date', operator: '<=', value: range.end }], limit: 2 })).records
    if (records.length > 1) throw attendanceError('Duplicate attendance records require reconciliation', 409)
    const attendance = records[0]
    if (!attendance?.checkIn || attendance.checkOut) return NextResponse.json({ success: true, message: 'Not checked in or already checked out', isCheckedIn: false })
    const result = await evaluateEmployeeGeofence({ database, settings, latitude, longitude, accuracy, locationSource, employeeId: employee._id, departmentId: employee.department?._id, companyId: employee.company?._id })
    if (!result.enabled || result.withinGeofence) return NextResponse.json({ success: true, message: result.message, withinGeofence: true, isCheckedIn: true, location: result.closestLocation?.name })
    if (result.code !== 'OUTSIDE_GEOFENCE') return NextResponse.json({ success: true, message: result.message, withinGeofence: null, isCheckedIn: true, geofenceEvaluated: false })
    const now = new Date()
    const updated = await database.transaction(async tx => {
      const [current, overtime] = await Promise.all([tx.get('attendances', attendance._id), tx.list('overtimerequests', { filters: [{ field: 'attendance', operator: '==', value: attendance._id }], limit: 40, requireComplete: true })])
      if (!current?.checkIn || current.checkOut) throw attendanceError('Attendance already closed', 409)
      const next = finishAttendance(current, now, settings, { checkOutStatus: 'auto-checkout', autoCheckedOut: true, autoCheckoutReason: 'geofence_exit', autoCheckoutAt: now, source: 'auto_checkout',
        location: { ...current.location, checkOut: { latitude: Number(latitude), longitude: Number(longitude), address: 'Auto-checkout: Outside geofence', capturedAt: now, autoCheckout: true } } })
      await tx.replace('attendances', next)
      for (const item of overtime.records) if (item.status === 'pending') await tx.replace('overtimerequests', { ...item, status: 'auto-checkout', autoCheckoutAt: now, autoCheckoutReason: 'User left office geofence area', updatedAt: now })
      return next
    })
    if (process.env.TALIO_LOCAL_ACCEPTANCE !== '1') await sendPushToUser(attendanceId(user._id || user.userId), { title: 'Auto Clock-Out: Left Office', body: 'You have been automatically clocked out as you left the office area. Work hours: ' + updated.workHours + 'h' }, { database, eventType: 'autoCheckout', clickAction: '/dashboard/attendance', data: { type: 'geofence-auto-checkout', checkoutTime: now.toISOString(), workHours: updated.workHours, status: updated.status } }).catch(() => {})
    return NextResponse.json({ success: true, message: 'Auto clocked out - user left office geofence', withinGeofence: false, isCheckedIn: false, autoCheckout: true, checkOutTime: now.toISOString(), workHours: updated.workHours, status: updated.status, distance: result.closestDistance, closestLocation: result.closestLocation?.name })
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }) }
}
