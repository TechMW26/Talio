import { attendanceError, attendanceKey, pickCanonicalAttendance } from './firestoreAttendance.server'
import { getEndOfDayInTimezone } from '@/lib/timezone'

/** Keep one attendance day and its overtime decisions in the same transaction. */
export async function saveAttendancePunch(database, { employeeId, date, timezone, type, changes, expected }) {
  return database.transaction(async tx => {
    const employee = await tx.get('employees', employeeId)
    if (!employee) throw attendanceError('Employee not found', 404)
    const found = (await tx.list('attendances', { filters: [{ field: 'employee', operator: '==', value: employeeId }, { field: 'date', operator: '>=', value: date }, { field: 'date', operator: '<=', value: getEndOfDayInTimezone(date, timezone) }], limit: 10, requireComplete: true })).records
    const preferredId = attendanceKey(employeeId, date)
    const canonical = pickCanonicalAttendance(found, preferredId)
    // Self-heal: remove empty duplicate rows (no checkIn/checkOut) for this day.
    for (const extra of found) {
      if (!canonical || String(extra._id) === String(canonical._id)) continue
      console.warn('[attendance] removing empty duplicate record', { employeeId, id: extra._id, status: extra.status, source: extra.source, createdAt: extra.createdAt })
      await tx.delete('attendances', extra._id)
    }
    const id = canonical?._id || preferredId
    const current = canonical || await tx.get('attendances', id)
    const overtime = type === 'clock-out' ? (await tx.list('overtimerequests', { filters: [{ field: 'attendance', operator: '==', value: id }], limit: 40, requireComplete: true })).records : []
    if (type === 'clock-in' && current?.checkIn) throw attendanceError('Already clocked in today', 409)
    if (type === 'clock-out' && (!current?.checkIn || current.checkOut)) throw attendanceError('Attendance is already closed or not checked in', 409)
    if (type === 'clock-out' && expected && (+new Date(current.checkIn) !== +new Date(expected.checkIn) || +new Date(current.updatedAt || 0) !== +new Date(expected.updatedAt || 0))) throw attendanceError('Attendance changed; refresh and try again', 409)
    const next = { ...current, ...changes, _id: id, employee: employeeId, date: current?.date || date, createdAt: current?.createdAt || new Date(), updatedAt: new Date() }
    if (changes['location.checkIn']) { next.location = { ...current?.location, checkIn: changes['location.checkIn'] }; delete next['location.checkIn'] }
    for (const request of overtime) {
      if (request.status !== 'overtime-confirmed') continue
      next.overtime = Number(Math.max(0, (new Date(next.checkOut) - new Date(request.scheduledCheckOut)) / 3600000).toFixed(2))
    }
    if (current) await tx.replace('attendances', next)
    else await tx.create('attendances', next)
    for (const request of overtime) if (request.status === 'overtime-confirmed') await tx.replace('overtimerequests', { ...request, overtimeHours: next.overtime, status: 'manual-checkout', updatedAt: new Date() })
    return next
  })
}