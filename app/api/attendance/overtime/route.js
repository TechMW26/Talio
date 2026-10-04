import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { ATTENDANCE_DATABASE_OPTIONS, attendanceId, attendanceError, getAttendanceSettings } from '@/lib/platform/firestoreAttendance.server'
import { finishAttendance } from '@/lib/attendanceNotificationScheduler'
export const dynamic = 'force-dynamic'
const validId = id => /^[a-f0-9]{24}$/.test(id || '')
const failure = error => NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 })
async function context(request) {
  const auth = await getAuthAndDatabase(request, ATTENDANCE_DATABASE_OPTIONS)
  if (!auth.success) throw attendanceError(auth.message || 'Unauthorized', 401)
  const employeeId = attendanceId(auth.user.employeeId)
  const employee = employeeId ? await auth.database.get('employees', employeeId) : null
  if (!employee) throw attendanceError('Employee not found', 404)
  return { ...auth, employee }
}
export async function GET(request) {
  try {
    const { database, employee } = await context(request)
    const status = new URL(request.url).searchParams.get('status') || 'pending'
    if (!['all', 'pending', 'overtime-confirmed', 'manual-checkout', 'auto-checkout'].includes(status)) throw attendanceError('Invalid overtime status')
    const filters = [{ field: 'employee', operator: '==', value: employee._id }]
    if (status !== 'all') filters.push({ field: 'status', operator: '==', value: status })
    const records = (await database.list('overtimerequests', { filters, orderBy: [{ field: 'promptSentAt', direction: 'desc' }], limit: 10 })).records
    const data = await Promise.all(records.map(async r => ({ ...r, attendance: r.attendance ? await database.get('attendances', attendanceId(r.attendance)) : null })))
    return NextResponse.json({ success: true, data })
  } catch (error) { return failure(error) }
}
export async function POST(request) {
  try {
    const { database, employee } = await context(request)
    const { requestId, isWorkingOvertime } = await request.json()
    if (!validId(requestId) || typeof isWorkingOvertime !== 'boolean') throw attendanceError('A valid request ID and overtime decision are required')
    const defaults = await getAttendanceSettings(database)
    const settings = defaults.settings
    const company = employee.company ? await database.get('companies', attendanceId(employee.company)) : defaults.company
    const configured = { ...settings, ...company?.workingHours, breakTimings: company?.breakTimings || settings.breakTimings || [], timezone: company?.timezone || settings.timezone }
    const now = new Date()
    const data = await database.transaction(async tx => {
      const current = await tx.get('overtimerequests', requestId)
      if (!current || attendanceId(current.employee) !== employee._id || current.status !== 'pending') throw attendanceError('Overtime request not found or already processed', 409)
      const attendance = await tx.get('attendances', attendanceId(current.attendance))
      if (!attendance || attendanceId(attendance.employee) !== employee._id || attendance.checkOut || !attendance.checkIn) throw attendanceError('Attendance is already closed or unavailable', 409)
      const next = { ...current, respondedAt: now, updatedAt: now, isWorkingOvertime, status: isWorkingOvertime ? 'overtime-confirmed' : 'manual-checkout' }
      await tx.replace('overtimerequests', next)
      if (!isWorkingOvertime) await tx.replace('attendances', finishAttendance(attendance, now, configured))
      return isWorkingOvertime ? next : { overtimeRequest: next, checkOutTime: now }
    })
    return NextResponse.json({ success: true, message: isWorkingOvertime ? 'Overtime confirmed. Remember to check out when you finish!' : 'You have been clocked out successfully.', data })
  } catch (error) { return failure(error) }
}
export async function PATCH(request) {
  try {
    const { database, employee } = await context(request)
    const { attendanceId: id } = await request.json()
    if (!validId(id)) throw attendanceError('Invalid attendance ID')
    const data = await database.transaction(async tx => {
      const attendance = await tx.get('attendances', id)
      if (!attendance || attendanceId(attendance.employee) !== employee._id) throw attendanceError('Attendance not found', 404)
      // Do not accept a client-supplied checkout timestamp for paid overtime.
      if (!attendance.checkOut) throw attendanceError('Check out before recording overtime', 409)
      const records = (await tx.list('overtimerequests', { filters: [{ field: 'attendance', operator: '==', value: id }], limit: 40, requireComplete: true })).records
      const current = records.find(r => r.status === 'overtime-confirmed' && attendanceId(r.employee) === employee._id)
      if (!current) return null
      const overtimeHours = Number(Math.max(0, (new Date(attendance.checkOut) - new Date(current.scheduledCheckOut)) / 3600000).toFixed(2))
      const next = { ...current, overtimeHours, status: 'manual-checkout', updatedAt: new Date() }
      await tx.replace('overtimerequests', next)
      await tx.replace('attendances', { ...attendance, overtime: overtimeHours, updatedAt: new Date() })
      return { overtimeHours, overtimeRequest: next }
    })
    return NextResponse.json({ success: true, message: data ? 'Overtime recorded' : 'No overtime request found', data })
  } catch (error) { return failure(error) }
}
