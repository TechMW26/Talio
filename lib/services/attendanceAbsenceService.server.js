import { sendPushToUser } from '@/lib/pushNotification'
import {
  getDateKeyInTimezone,
  getDayNameInTimezone,
  getEndOfDayInTimezone,
  getStartOfDayInTimezone,
  getTimezone,
} from '@/lib/timezone'

const DEFAULT_WORKING_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']

export function getDayName(date, timezone = 'Asia/Kolkata') {
  return getDayNameInTimezone(date, timezone)
}

export function isWorkingDay(date, workingDays, timezone = 'Asia/Kolkata') {
  const configured = Array.isArray(workingDays) && workingDays.length ? workingDays : DEFAULT_WORKING_DAYS
  return configured.includes(getDayName(date, timezone))
}

export async function resolveAttendanceCalendar(models) {
  const [company, settings] = await Promise.all([
    models.Company.findOne().select('workingHours timezone').lean(),
    models.CompanySettings.findOne().select('workingDays timezone').lean(),
  ])
  return {
    timezone: getTimezone(company?.timezone || company?.workingHours?.timezone || settings?.timezone),
    workingDays: company?.workingHours?.workingDays?.length
      ? company.workingHours.workingDays
      : settings?.workingDays?.length
        ? settings.workingDays
        : DEFAULT_WORKING_DAYS,
  }
}

export async function processAbsenceDate({ models, date, dryRun = false, sendNotifications = false }) {
  const calendar = await resolveAttendanceCalendar(models)
  const dayStart = getStartOfDayInTimezone(date, calendar.timezone)
  const dayEnd = getEndOfDayInTimezone(date, calendar.timezone)
  const result = {
    date: getDateKeyInTimezone(dayStart, calendar.timezone),
    dayOfWeek: getDayName(dayStart, calendar.timezone),
    configuredWorkingDays: calendar.workingDays,
    timezone: calendar.timezone,
    skipped: false,
    skipReason: null,
    marked: 0,
    onLeave: 0,
    hadAttendance: 0,
    notYetJoined: 0,
    notificationsSent: 0,
    notificationsFailed: 0,
    errors: 0,
    dryRun,
  }

  if (!isWorkingDay(dayStart, calendar.workingDays, calendar.timezone)) {
    return { ...result, skipped: true, skipReason: 'weekend' }
  }

  const holiday = await models.Holiday.findOne({
    isActive: true,
    $or: [
      { date: { $gte: dayStart, $lte: dayEnd } },
      { date: { $lte: dayStart }, endDate: { $gte: dayStart } },
    ],
  }).select('name type').lean()
  if (holiday) return { ...result, skipped: true, skipReason: 'holiday', holiday }

  const [employees, leaves, attendance] = await Promise.all([
    models.Employee.find({ status: 'active' }).select('_id firstName lastName dateOfJoining userId').populate('userId', '_id').lean(),
    models.Leave.find({
      status: 'approved',
      workFromHome: { $ne: true },
      requestType: { $ne: 'early_leave' },
      startDate: { $lte: dayEnd },
      endDate: { $gte: dayStart },
    }).select('employee').lean(),
    models.Attendance.find({ date: { $gte: dayStart, $lte: dayEnd } }).select('employee').lean(),
  ])

  const leaveIds = new Set(leaves.map((item) => String(item.employee)))
  const attendanceIds = new Set(attendance.map((item) => String(item.employee)))
  result.onLeave = leaveIds.size
  result.hadAttendance = attendanceIds.size

  const candidates = employees.filter((employee) => {
    const employeeId = String(employee._id)
    if (attendanceIds.has(employeeId) || leaveIds.has(employeeId) || !employee.userId) return false
    if (employee.dateOfJoining && getStartOfDayInTimezone(employee.dateOfJoining, calendar.timezone) > dayStart) {
      result.notYetJoined += 1
      return false
    }
    return true
  })

  if (dryRun || !candidates.length) return { ...result, marked: candidates.length }

  const operations = candidates.map((employee) => ({
    updateOne: {
      filter: { employee: employee._id, date: { $gte: dayStart, $lte: dayEnd } },
      update: {
        $setOnInsert: {
          employee: employee._id,
          date: dayStart,
          status: 'absent',
          workHours: 0,
          totalLoggedHours: 0,
          breakMinutes: 0,
          shrinkagePercentage: 0,
          statusReason: 'No check-in recorded',
          remarks: 'System auto-marked absent - No attendance recorded for working day',
          isManualEntry: false,
          source: 'system_auto_absent',
          createdBySystem: true,
        },
      },
      upsert: true,
    },
  }))
  const writeResult = await models.Attendance.bulkWrite(operations, { ordered: false })
  const insertedIndexes = Object.keys(writeResult.upsertedIds || {}).map(Number)
  result.marked = writeResult.upsertedCount || insertedIndexes.length

  if (sendNotifications && insertedIndexes.length) {
    const outcomes = await Promise.allSettled(insertedIndexes.map((index) => {
      const employee = candidates[index]
      return sendPushToUser(employee.userId._id || employee.userId, {
        title: 'Attendance marked absent',
        body: `No check-in was recorded for ${dayStart.toLocaleDateString('en-IN', { timeZone: calendar.timezone, weekday: 'long', day: 'numeric', month: 'short' })}. Raise a correction request if needed.`,
      }, {
        eventType: 'markedAbsent',
        clickAction: '/dashboard/attendance',
        icon: '/icons/icon-192x192.png',
        data: { type: 'marked-absent', date: dayStart.toISOString() },
      })
    }))
    result.notificationsSent = outcomes.filter((outcome) => outcome.status === 'fulfilled').length
    result.notificationsFailed = outcomes.length - result.notificationsSent
  }

  return result
}

export async function getAbsenceStatus({ models, date }) {
  const calendar = await resolveAttendanceCalendar(models)
  const dayStart = getStartOfDayInTimezone(date, calendar.timezone)
  const dayEnd = getEndOfDayInTimezone(date, calendar.timezone)
  const [holiday, attendanceStats, systemGenerated, totalEmployees, onLeave] = await Promise.all([
    models.Holiday.findOne({ isActive: true, $or: [{ date: { $gte: dayStart, $lte: dayEnd } }, { date: { $lte: dayStart }, endDate: { $gte: dayStart } }] }).select('name type').lean(),
    models.Attendance.aggregate([{ $match: { date: { $gte: dayStart, $lte: dayEnd } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    models.Attendance.countDocuments({ date: { $gte: dayStart, $lte: dayEnd }, $or: [{ source: 'system_auto_absent' }, { createdBySystem: true }] }),
    models.Employee.countDocuments({ status: 'active' }),
    models.Leave.countDocuments({ status: 'approved', workFromHome: { $ne: true }, requestType: { $ne: 'early_leave' }, startDate: { $lte: dayEnd }, endDate: { $gte: dayStart } }),
  ])
  const attendance = Object.fromEntries(attendanceStats.map((item) => [item._id, item.count]))
  const accounted = Object.values(attendance).reduce((sum, count) => sum + count, 0)
  const workDay = isWorkingDay(dayStart, calendar.workingDays, calendar.timezone)
  return {
    date: getDateKeyInTimezone(dayStart, calendar.timezone), dayOfWeek: getDayName(dayStart, calendar.timezone), timezone: calendar.timezone,
    isWorkingDay: workDay, configuredWorkingDays: calendar.workingDays, isHoliday: Boolean(holiday), holiday,
    totalEmployees, onLeave, attendance, systemGenerated, userGenerated: accounted - systemGenerated,
    unaccounted: workDay && !holiday ? Math.max(0, totalEmployees - accounted - onLeave) : 0,
  }
}
