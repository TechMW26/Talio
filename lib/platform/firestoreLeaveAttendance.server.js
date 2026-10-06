import { attendanceId } from './firestoreAttendance.server'
import { getDateKeyInTimezone, getTimezone } from '@/lib/timezone'

const blocking = leave => !leave.workFromHome && leave.requestType !== 'early_leave' && !leave.isHalfDay && leave.requestType !== 'half_day'
const overlaps = (leave, date, timezone) => getDateKeyInTimezone(leave.startDate, timezone) <= getDateKeyInTimezone(date, timezone) && getDateKeyInTimezone(leave.endDate, timezone) >= getDateKeyInTimezone(date, timezone)

/** Prepare only reads. Invoke the returned writer after all other approval reads.
 * The employee guard serializes leave decisions with absence workers; records
 * created by people or devices are never overwritten by a leave transition.
 */
export async function prepareLeaveAttendanceTransition(tx, employee, currentLeave, nextStatus) {
  if (!blocking(currentLeave) || !['approved', 'cancelled', 'rejected'].includes(nextStatus)) return async () => {}
  const employeeId = attendanceId(employee)
  const start = new Date(currentLeave.startDate), end = new Date(currentLeave.endDate)
  const days = Math.ceil((end - start) / 86400000) + 1
  if (!Number.isFinite(days) || days < 1 || days > 366) throw Object.assign(new Error('Leave attendance reconciliation supports up to 366 days'), { status: 409 })
  const [guard, attendance, approved, companies, settings] = await Promise.all([
    tx.get('attendanceleaveguards', employeeId),
    tx.list('attendances', { filters: [{ field: 'employee', operator: '==', value: employeeId }, { field: 'date', operator: '>=', value: new Date(start.getTime() - 86400000) }, { field: 'date', operator: '<=', value: new Date(end.getTime() + 86400000) }], limit: 370, requireComplete: true }),
    tx.list('leaves', { filters: [{ field: 'employee', operator: '==', value: employeeId }, { field: 'status', operator: '==', value: 'approved' }, { field: 'startDate', operator: '<=', value: new Date(end.getTime() + 86400000) }, { field: 'endDate', operator: '>=', value: new Date(start.getTime() - 86400000) }], limit: 400, requireComplete: true }),
    employee.company ? tx.get('companies', attendanceId(employee.company)) : null,
    tx.list('companysettings', { limit: 1 }),
  ])
  const timezone = getTimezone(companies?.timezone || companies?.workingHours?.timezone || settings.records[0]?.timezone)
  const applicable = approved.records.filter(l => l._id !== currentLeave._id && blocking(l))
  if (nextStatus === 'approved') applicable.push(currentLeave)
  const updates = attendance.records.filter(a => a.source === 'system_auto_absent' && !a.checkIn && (overlaps(currentLeave, new Date(a.date), timezone) || a.leaveOverride?.leaveId === currentLeave._id)).map(a => {
    const leave = applicable.find(l => overlaps(l, new Date(a.date), timezone))
    if (leave) return { ...a, status: 'on-leave', statusReason: 'Approved leave', leaveOverride: { leaveId: leave._id, previousStatus: a.leaveOverride?.previousStatus || a.status }, updatedAt: new Date() }
    if (!a.leaveOverride) return null
    const next = { ...a, status: a.leaveOverride.previousStatus || 'absent', statusReason: 'No check-in recorded', updatedAt: new Date() }
    delete next.leaveOverride
    return next
  }).filter(Boolean)
  if (updates.length > 366) throw Object.assign(new Error('Attendance range requires reconciliation'), { status: 409 })
  return async () => {
    const nextGuard = { _id: employeeId, revision: Number(guard?.revision || 0) + 1, updatedAt: new Date() }
    if (guard) await tx.replace('attendanceleaveguards', nextGuard)
    else await tx.create('attendanceleaveguards', nextGuard)
    for (const record of updates) await tx.replace('attendances', record)
  }
}
