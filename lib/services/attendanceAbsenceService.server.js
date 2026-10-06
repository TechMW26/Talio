import { sendPushToUser } from '@/lib/pushNotification'
import { attendanceKey, getAttendanceSettings, listAttendanceRecords } from '@/lib/platform/firestoreAttendance.server'
import { getDateKeyInTimezone, getDayNameInTimezone, getEndOfDayInTimezone, getStartOfDayInTimezone, getTimezone } from '@/lib/timezone'
import { isHolidayApplicable, isFullDayHoliday } from '@/lib/holidayPolicy'

const DEFAULT_WORKING_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
export const getDayName = (date, timezone = 'Asia/Kolkata') => getDayNameInTimezone(date, timezone)
export function isWorkingDay(date, workingDays, timezone = 'Asia/Kolkata') {
  return (Array.isArray(workingDays) && workingDays.length ? workingDays : DEFAULT_WORKING_DAYS).includes(getDayName(date, timezone))
}
export async function resolveAttendanceCalendar(database, companyId) {
  const defaults = await getAttendanceSettings(database)
  const company = companyId ? await database.get('companies', String(companyId)) : defaults.company
  const settings = defaults.settings
  return {
    timezone: getTimezone(company?.timezone || company?.workingHours?.timezone || settings?.timezone),
    workingDays: company?.workingHours?.workingDays?.length ? company.workingHours.workingDays : settings?.workingDays?.length ? settings.workingDays : DEFAULT_WORKING_DAYS,
  }
}
export async function getAttendanceDayContext(database, date, { companyId, calendar: configured } = {}) {
  const calendar = configured || await resolveAttendanceCalendar(database, companyId)
  const dayStart = getStartOfDayInTimezone(date, calendar.timezone)
  const dayEnd = getEndOfDayInTimezone(date, calendar.timezone)
  const filters = [{ field: 'status', operator: 'in', value: ['active', 'probation'] }]
  if (companyId) filters.push({ field: 'company', operator: '==', value: String(companyId) })
  const [employees, leaves, attendance, holidays] = await Promise.all([
    listAttendanceRecords(database, 'employees', filters),
    listAttendanceRecords(database, 'leaves', [{ field: 'status', operator: '==', value: 'approved' }, { field: 'startDate', operator: '<=', value: dayEnd }, { field: 'endDate', operator: '>=', value: dayStart }]),
    listAttendanceRecords(database, 'attendances', [{ field: 'date', operator: '>=', value: dayStart }, { field: 'date', operator: '<=', value: dayEnd }]),
    listAttendanceRecords(database, 'holidays', [{ field: 'isActive', operator: '==', value: true }, { field: 'date', operator: '<=', value: dayEnd }]),
  ])
  const employeeIds = new Set(employees.map(e => String(e._id)))
  const scopedAttendance = companyId ? attendance.filter(a => employeeIds.has(String(a.employee))) : attendance
  const scopedLeaves = leaves.filter(l => !l.workFromHome && l.requestType !== 'early_leave' && (!companyId || employeeIds.has(String(l.employee))))
  const activeHolidays = holidays.filter(h => new Date(h.date) >= dayStart || (h.endDate && new Date(h.endDate) >= dayStart))
  const holiday = activeHolidays.find(h => employees.every(e => isHolidayApplicable(h, e))) || null
  return { calendar, dayStart, dayEnd, employees, leaves: scopedLeaves, attendance: scopedAttendance, holiday, holidays: activeHolidays }
}

export async function processAbsenceDate({ database, date, dryRun = false, sendNotifications = false, companyId, calendar, onlyUnassigned = false }) {
  const context = await getAttendanceDayContext(database, date, { companyId, calendar })
  const { dayStart, employees, leaves, attendance, holiday } = context
  calendar = context.calendar
  const result = {
    date: getDateKeyInTimezone(dayStart, calendar.timezone), dayOfWeek: getDayName(dayStart, calendar.timezone),
    configuredWorkingDays: calendar.workingDays, timezone: calendar.timezone, skipped: false, skipReason: null,
    marked: 0, onLeave: 0, hadAttendance: 0, notYetJoined: 0, notificationsSent: 0, notificationsFailed: 0, errors: 0, dryRun,
  }
  if (!isWorkingDay(dayStart, calendar.workingDays, calendar.timezone)) return { ...result, skipped: true, skipReason: 'weekend' }
  if (isFullDayHoliday(holiday)) return { ...result, skipped: true, skipReason: 'holiday', holiday }
  const leaveIds = new Set(leaves.map(item => String(item.employee)))
  const attendanceIds = new Set(attendance.map(item => String(item.employee)))
  result.onLeave = leaveIds.size
  result.hadAttendance = attendanceIds.size
  const candidates = employees.filter(employee => {
    if (onlyUnassigned && employee.company) return false
    if (context.holidays.some(h => isFullDayHoliday(h) && isHolidayApplicable(h, employee))) return false
    if (attendanceIds.has(String(employee._id)) || leaveIds.has(String(employee._id)) || !employee.userId) return false
    if (employee.dateOfJoining && getStartOfDayInTimezone(employee.dateOfJoining, calendar.timezone) > dayStart) { result.notYetJoined++; return false }
    return true
  })
  if (dryRun) return { ...result, marked: candidates.length }
  for (const employee of candidates) {
    try {
      const inserted = await database.transaction(async tx => {
        const id = attendanceKey(employee._id, dayStart)
        const [existing, currentEmployee, , approved, dayRecords] = await Promise.all([
          tx.get('attendances', id), tx.get('employees', employee._id), tx.get('attendanceleaveguards', employee._id),
          tx.list('leaves', { filters: [{ field: 'employee', operator: '==', value: employee._id }, { field: 'status', operator: '==', value: 'approved' }, { field: 'startDate', operator: '<=', value: context.dayEnd }, { field: 'endDate', operator: '>=', value: dayStart }], limit: 100, requireComplete: true }),
          tx.list('attendances', { filters: [{ field: 'employee', operator: '==', value: employee._id }, { field: 'date', operator: '>=', value: dayStart }, { field: 'date', operator: '<=', value: context.dayEnd }], limit: 2, requireComplete: true }),
        ])
        if (existing || dayRecords.records.length || approved.records.some(l => !l.workFromHome && l.requestType !== 'early_leave') || !currentEmployee || !['active', 'probation'].includes(currentEmployee.status)) return false
        await tx.create('attendances', {
          _id: id, employee: employee._id, date: dayStart, status: 'absent', workHours: 0, totalLoggedHours: 0, breakMinutes: 0,
          shrinkagePercentage: 0, statusReason: 'No check-in recorded', remarks: 'System auto-marked absent - No attendance recorded for working day',
          isManualEntry: false, source: 'system_auto_absent', createdBySystem: true, createdAt: new Date(), updatedAt: new Date(),
        })
        return true
      })
      if (!inserted) continue
      result.marked++
      if (sendNotifications && process.env.TALIO_LOCAL_ACCEPTANCE !== '1') {
        try {
          await sendPushToUser(String(employee.userId), {
            title: 'Attendance marked absent',
            body: 'No check-in was recorded for ' + dayStart.toLocaleDateString('en-IN', { timeZone: calendar.timezone, weekday: 'long', day: 'numeric', month: 'short' }) + '. Raise a correction request if needed.',
          }, { database, eventType: 'markedAbsent', clickAction: '/dashboard/attendance', icon: '/icons/icon-192x192.png', data: { type: 'marked-absent', date: dayStart.toISOString() } })
          result.notificationsSent++
        } catch { result.notificationsFailed++ }
      }
    } catch { result.errors++ }
  }
  return result
}

export async function getAbsenceStatus({ database, date }) {
  const { calendar, dayStart, employees, leaves, attendance: records, holiday } = await getAttendanceDayContext(database, date)
  const attendance = {}
  for (const record of records) attendance[record.status] = (attendance[record.status] || 0) + 1
  const systemGenerated = records.filter(a => a.source === 'system_auto_absent' || a.createdBySystem).length
  const workDay = isWorkingDay(dayStart, calendar.workingDays, calendar.timezone)
  const isFullDayHoliday = Boolean(holiday && (!holiday.dayPortion || holiday.dayPortion === 'full_day'))
  const leaveIds = new Set(leaves.map(l => String(l.employee)))
  const accounted = new Set([...records.map(a => String(a.employee)), ...leaveIds])
  return {
    date: getDateKeyInTimezone(dayStart, calendar.timezone), dayOfWeek: getDayName(dayStart, calendar.timezone), timezone: calendar.timezone,
    isWorkingDay: workDay, configuredWorkingDays: calendar.workingDays, isHoliday: Boolean(holiday), isFullDayHoliday, holiday,
    totalEmployees: employees.length, onLeave: leaveIds.size, attendance, systemGenerated, userGenerated: records.length - systemGenerated,
    unaccounted: workDay && !isFullDayHoliday ? employees.filter(e => !accounted.has(String(e._id))).length : 0,
  }
}
