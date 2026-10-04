import { attendanceKey, attendanceId, attendanceError, listAttendanceRecords } from './firestoreAttendance.server'
import { resolveAttendanceCalendar } from '@/lib/services/attendanceAbsenceService.server'
import { getAttendanceDayRange } from '@/lib/attendanceAutoCheckout'
import { isHolidayApplicable, isFullDayHoliday } from '@/lib/holidayPolicy'

// Each employee/day is independently retryable. Existing work and human corrections remain untouched.
export async function syncHolidayAttendance(database, { year = new Date().getFullYear(), dryRun = false } = {}) {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw attendanceError('Invalid holiday year')
  const holidays = await listAttendanceRecords(database, 'holidays', [
    { field: 'isActive', operator: '==', value: true },
    { field: 'date', operator: '<=', value: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)) },
  ], 5000)
  const employees = await listAttendanceRecords(database, 'employees', [{ field: 'status', operator: 'in', value: ['active', 'probation'] }])
  const result = { created: 0, updated: 0, skipped: 0, dryRun }
  const calendars = new Map()
  for (const holiday of holidays) {
    if (!isFullDayHoliday(holiday)) continue
    const startKey = new Date(holiday.date).toISOString().slice(0, 10)
    const endKey = new Date(holiday.endDate || holiday.date).toISOString().slice(0, 10)
    const start = Math.max(+new Date(startKey), Date.UTC(year, 0, 1))
    const end = Math.min(+new Date(endKey), Date.UTC(year, 11, 31))
    if ((end - start) / 86400000 > 366) throw attendanceError('Holiday range exceeds one year')
    for (let date = start; date <= end; date += 86400000) {
      const key = new Date(date).toISOString().slice(0, 10)
      for (const employee of employees) {
        if (!isHolidayApplicable(holiday, employee)) continue
        const companyId = attendanceId(employee.company)
        if (!calendars.has(companyId)) calendars.set(companyId, await resolveAttendanceCalendar(database, companyId))
        const { start: dayStart, end: dayEnd } = getAttendanceDayRange(key, calendars.get(companyId).timezone)
        if (employee.dateOfJoining && new Date(employee.dateOfJoining) > dayEnd) continue
        const outcome = await database.transaction(async tx => {
          const [currentHoliday, currentEmployee, dayRecords] = await Promise.all([
            tx.get('holidays', holiday._id), tx.get('employees', employee._id),
            tx.list('attendances', { filters: [{ field: 'employee', operator: '==', value: employee._id }, { field: 'date', operator: '>=', value: dayStart }, { field: 'date', operator: '<=', value: dayEnd }], limit: 2, requireComplete: true }),
          ])
          if (!currentEmployee || !['active', 'probation'].includes(currentEmployee.status) || !isHolidayApplicable(currentHoliday, currentEmployee) || !isFullDayHoliday(currentHoliday)) return 'skipped'
          // A concurrent edit of the holiday schedule invalidates this plan.
          if (+new Date(currentHoliday.date) !== +new Date(holiday.date) || +new Date(currentHoliday.endDate || currentHoliday.date) !== +new Date(holiday.endDate || holiday.date)) return 'skipped'
          if (dayRecords.records.length > 1) throw attendanceError('Duplicate attendance records require reconciliation', 409)
          const current = dayRecords.records[0]
          if (current && (current.checkIn || current.checkOut || current.source === 'correction' || current.isManualEntry || !['absent', 'holiday', undefined, null].includes(current.status))) return 'skipped'
          if (current?.status === 'holiday') return 'skipped'
          const next = { ...current, _id: current?._id || attendanceKey(employee._id, dayStart), employee: employee._id, date: dayStart, status: 'holiday', statusReason: currentHoliday.name, workHours: 0, source: 'holiday_sync', holidayId: holiday._id, updatedAt: new Date(), ...(!current ? { createdAt: new Date(), createdBySystem: true } : {}) }
          if (!dryRun) { if (current) await tx.replace('attendances', next); else await tx.create('attendances', next) }
          return current ? 'updated' : 'created'
        })
        result[outcome]++
      }
    }
  }
  return result
}
