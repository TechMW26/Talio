import { createHash } from 'node:crypto'
import { isHolidayApplicable, isFullDayHoliday } from '@/lib/holidayPolicy'
import { getFirestoreSystemDatabase } from '@/lib/platform/firestoreApplication.server'
import { enqueueBackgroundJob } from '@/lib/platform/firestoreBackgroundJobs.server'
import { getAttendanceStore, getAttendanceSettings, listAttendanceRecords, attendanceId } from '@/lib/platform/firestoreAttendance.server'
import { calculateEffectiveWorkHours, determineAttendanceStatus } from '@/lib/attendanceShrinkage'
import { getAttendanceDayRange, resolveScheduledCheckout } from '@/lib/attendanceAutoCheckout'
import { getAttendanceDayContext, processAbsenceDate, isWorkingDay } from '@/lib/services/attendanceAbsenceService.server'
import { getDateKeyInTimezone, getDayNameInTimezone, getTimezone, parseDateTimeInTimezone } from '@/lib/timezone'

// Fun notification messages for different occasions
const FUN_MESSAGES = {
  officeStart: [
    "☕ Time to grab your coffee! Office starts in 15 minutes. Let's make today amazing!",
    "🚀 T-minus 15 minutes to launch! Ready to conquer the day?",
    "🌟 Rise and shine, superstar! 15 minutes until showtime.",
    "⏰ Heads up! The office door opens in 15 minutes. Don't forget your smile!",
    "🎯 15 minutes to go! Time to put on your superhero cape.",
    "🌅 Good morning, legend! Office starts in 15 minutes. You've got this!",
    "💪 Power up! Just 15 minutes until we start crushing goals.",
    "🎵 *Office theme song plays* 15 minutes to curtain call!",
    "🏃 On your marks... 15 minutes to office time!",
    "✨ Magic happens in 15 minutes! Ready to make some?",
  ],
  breakStart: [
    "🍔 Break time! Your snack is calling. Enjoy your well-deserved rest!",
    "☕ Time to recharge! Take a breather, you've earned it.",
    "🧘 Pause button activated! Stretch, breathe, and refresh.",
    "🎮 Break time unlocked! Level up your energy.",
    "🌿 Nature break! Step away and reset your mind.",
  ],
  breakEnd: [
    "⚡ Break's over! Time to bring the energy back.",
    "🎯 Back to action! Let's finish strong.",
    "💼 Recharging complete! Ready for round two?",
    "🚀 Engines back online! Let's continue the mission.",
    "🌟 Welcome back! Time to shine again.",
  ],
  workOff: [
    "🎉 You did it! Time to clock out and celebrate.",
    "🌅 The day is done! Go enjoy your evening, champion.",
    "🏠 Home time! You've earned your rest.",
    "🎊 Work mode: OFF. Relaxation mode: ON!",
    "🌙 That's a wrap! See you tomorrow, superstar!",
    "🎯 Goals crushed! Time to recharge for tomorrow.",
    "🍕 Pizza time? Work's done, treat yourself!",
    "🎬 And... cut! That's a wrap on today.",
  ],
  overtimeCheck: [
    "🕐 Hey! Your shift ended 30 mins ago. Are you working overtime or just forgot to clock out?",
    "⏰ Still here? Just checking - are you doing overtime or need to clock out?",
    "🤔 Your shift ended a while ago. Working late or forgot to leave?",
    "⌛ 30 minutes past your shift! Confirm if you're doing overtime.",
    "🔔 Overtime check! Are you still working or should we clock you out?",
  ],
  autoCheckout: [
    "🚪 Auto clocked out! No response received about overtime.",
    "⏰ You've been automatically clocked out as no response was received.",
    "🔒 Shift closed automatically. Your work hours have been recorded.",
  ],
}

/**
 * Get a random fun message for the given occasion
 */
function getRandomMessage(occasion) {
  const messages = FUN_MESSAGES[occasion] || FUN_MESSAGES.officeStart
  return messages[Math.floor(Math.random() * messages.length)]
}

/**
 * Generate AI-powered notification message using the shared custom AI service
 */
async function generateAIMessage(occasion, employeeName, context = {}) {
  try {
    const { generateContent, getAIAvailability } = await import('./gemini.js')
    if (!getAIAvailability().anyAvailable) {
      // Fall back to random pre-defined message
      return getRandomMessage(occasion)
    }

    const prompts = {
      officeStart: `Generate a short, fun, and motivating notification message (max 100 chars) for an employee named ${employeeName} that office starts in 15 minutes. Be creative, use emojis, and make it feel personal and encouraging.`,
      breakStart: `Generate a short, relaxing notification message (max 80 chars) for ${employeeName} that it's break time. Use emojis and encourage them to take a proper break.`,
      breakEnd: `Generate a short, energizing notification message (max 80 chars) for ${employeeName} that break is ending. Use emojis and motivate them to get back to work.`,
      workOff: `Generate a short, celebratory notification message (max 80 chars) for ${employeeName} that work day is ending. Use emojis and congratulate them.`,
    }
    const systemInstruction = 'You are a friendly workplace assistant. Generate short, fun notification messages with emojis. Keep messages under 100 characters.'
    const aiMessage = await generateContent(prompts[occasion] || prompts.officeStart, systemInstruction, { useCase: 'chat' })

    return aiMessage?.trim() || getRandomMessage(occasion)
  } catch (error) {
    console.error('AI message generation failed:', error)
    return getRandomMessage(occasion)
  }
}


const sameMinute = (a, b) => b && Math.floor(a.getTime() / 60000) === Math.floor(b.getTime() / 60000)
const eventId = value => createHash('sha256').update(value).digest('hex')
const belongs = (employee, filter) => filter.company === undefined || (filter.company === null ? !employee.company : attendanceId(employee.company) === String(filter.company))
const atTime = (date, time, timezone) => parseDateTimeInTimezone(getDateKeyInTimezone(date, timezone) + 'T' + time + ':00', timezone)

export function finishAttendance(record, checkOut, settings = {}, extra = {}) {
  const result = calculateEffectiveWorkHours(record.checkIn, checkOut, settings.breakTimings || [], { timezone: getTimezone(settings.timezone) })
  const status = determineAttendanceStatus(result.effectiveWorkHours, settings)
  return { ...record, ...extra, checkOut, workHours: result.effectiveWorkHours, totalLoggedHours: result.totalLoggedHours, breakMinutes: result.breakMinutes,
    shrinkagePercentage: result.shrinkagePercentage, status: status.status, statusReason: status.reason, updatedAt: new Date() }
}
async function notify(database, employee, key, title, message, data = {}) {
  if (process.env.TALIO_LOCAL_ACCEPTANCE === '1') return false
  if (!employee?.userId) return false
  await enqueueBackgroundJob('notification', { databaseName: database.databaseName, userIds: [attendanceId(employee.userId)], title, message, url: '/dashboard/attendance', data: { type: 'attendance', ...data } },
    { id: eventId('attendance:' + key + ':' + employee._id) })
  return true
}
async function activeEmployees(database, settings, filter, referenceDate) {
  const { employees, leaves, holidays } = await getAttendanceDayContext(database, referenceDate, { companyId: filter.company || undefined, calendar: { timezone: getTimezone(settings.timezone), workingDays: settings.workingDays } })
  if (!isWorkingDay(referenceDate, settings.workingDays, getTimezone(settings.timezone))) return []
  const onLeave = new Set(leaves.map(l => attendanceId(l.employee)))
  return employees.filter(e => e.userId && belongs(e, filter) && !onLeave.has(e._id) && !holidays.some(h => isFullDayHoliday(h) && isHolidayApplicable(h, e)))
}
async function sendScheduled(database, settings, filter, referenceDate, occasion, title, suffix = '') {
  let sent = 0
  for (const employee of await activeEmployees(database, settings, filter, referenceDate)) {
    const key = getDateKeyInTimezone(referenceDate, getTimezone(settings.timezone)) + ':' + occasion + ':' + suffix
    if (await notify(database, employee, key, title, getRandomMessage(occasion), { occasion, breakName: suffix || undefined })) sent++
  }
  return { sent }
}
export const sendPreOfficeNotifications = (database, settings, filter = {}, date = new Date()) => sendScheduled(database, settings, filter, date, 'officeStart', 'Office Time Reminder')
export const sendBreakStartNotifications = (database, name, settings, filter = {}, date = new Date()) => sendScheduled(database, settings, filter, date, 'breakStart', name + ' break', name)
export const sendBreakEndNotifications = (database, name, settings, filter = {}, date = new Date()) => sendScheduled(database, settings, filter, date, 'breakEnd', name + ' break ending', name)
export const sendWorkOffNotifications = (database, settings, filter = {}, date = new Date()) => sendScheduled(database, settings, filter, date, 'workOff', 'Time to clock out')

async function openAttendance(database, settings, filter, date, backlog = false) {
  const range = getAttendanceDayRange(date, getTimezone(settings.timezone))
  const filters = [{ field: 'status', operator: '==', value: 'in-progress' }, { field: 'date', operator: '<=', value: backlog ? new Date(range.start.getTime() - 1) : range.end }]
  if (!backlog) filters.push({ field: 'date', operator: '>=', value: range.start })
  const records = await listAttendanceRecords(database, 'attendances', filters)
  const result = []
  for (const record of records) {
    if (!record.checkIn || record.checkOut) continue
    const employee = await database.get('employees', attendanceId(record.employee))
    if (employee && belongs(employee, filter)) result.push({ record, employee })
  }
  return result
}

export async function sendOvertimeCheckNotifications(database, settings, filter = {}, referenceDate = new Date()) {
  let sent = 0
  for (const { record, employee } of await openAttendance(database, settings, filter, referenceDate)) {
    if (!employee.userId) continue
    const scheduledCheckOut = resolveScheduledCheckout({ attendanceDate: record.date, checkIn: record.checkIn, checkOutTime: settings.checkOutTime || '18:00', timezone: getTimezone(settings.timezone) })
    if (!scheduledCheckOut || referenceDate < scheduledCheckOut) continue
    const id = eventId('overtime:' + record._id).slice(0, 24)
    const request = await database.transaction(async tx => {
      const [existing, attendance, legacy] = await Promise.all([
        tx.get('overtimerequests', id), tx.get('attendances', record._id),
        tx.list('overtimerequests', { filters: [{ field: 'attendance', operator: '==', value: record._id }], limit: 100, requireComplete: true }),
      ])
      if (!attendance?.checkIn || attendance.checkOut || attendance.status !== 'in-progress') return null
      if (existing || legacy.records.length) return existing || legacy.records[0]
      const next = { _id: id, employee: employee._id, attendance: record._id, date: record.date, scheduledCheckOut, promptSentAt: referenceDate, status: 'pending', createdAt: referenceDate, updatedAt: referenceDate }
      await tx.create('overtimerequests', next)
      return next
    })
    if (request?.status === 'pending' && await notify(database, employee, 'overtime:' + request._id, 'Overtime check — response needed', getRandomMessage('overtimeCheck'), { requestId: request._id, requiresAction: true, scheduledCheckout: scheduledCheckOut.toISOString() })) sent++
  }
  return { sent }
}

async function closeRecords(database, settings, filter, referenceDate, backlog) {
  let processed = 0, notified = 0
  for (const { record, employee } of await openAttendance(database, settings, filter, referenceDate, backlog)) {
    const scheduled = resolveScheduledCheckout({ attendanceDate: record.date, checkIn: record.checkIn, checkOutTime: settings.checkOutTime || '18:00', timezone: getTimezone(settings.timezone) })
    if (!scheduled || (!backlog && referenceDate.getTime() < scheduled.getTime() + 2 * 3600000)) continue
    const closed = await database.transaction(async tx => {
      const [current, overtime] = await Promise.all([
        tx.get('attendances', record._id),
        tx.list('overtimerequests', { filters: [{ field: 'attendance', operator: '==', value: record._id }], limit: 40, requireComplete: true }),
      ])
      if (!current?.checkIn || current.checkOut || current.status !== 'in-progress') return null
      if (!backlog && overtime.records.some(r => r.status === 'overtime-confirmed')) return null
      const checkout = resolveScheduledCheckout({ attendanceDate: current.date, checkIn: current.checkIn, checkOutTime: settings.checkOutTime || '18:00', timezone: getTimezone(settings.timezone) })
      const next = finishAttendance(current, checkout, settings, { checkOutStatus: 'auto-checkout', autoCheckedOut: true, autoCheckoutReason: backlog ? 'midnight_cutoff' : 'overtime_timeout', autoCheckoutAt: referenceDate,
        remarks: [current.remarks, 'System auto-checkout at scheduled shift end'].filter(Boolean).join('; ') })
      await tx.replace('attendances', next)
      for (const request of overtime.records) if (request.status === 'pending') await tx.replace('overtimerequests', { ...request, status: 'auto-checkout', respondedAt: referenceDate, updatedAt: referenceDate })
      return next
    })
    if (!closed) continue
    processed++
    try { if (await notify(database, employee, 'auto-checkout:' + record._id, 'Attendance automatically checked out', getRandomMessage('autoCheckout'), { attendanceId: record._id })) notified++ } catch {}
  }
  return { processed, notified }
}
export const processAutoCheckouts = (database, settings, filter = {}, now = new Date()) => closeRecords(database, settings, filter, now, false)
export async function processPastDayIncompleteAttendance(database, settings, filter = {}, now = new Date()) {
  if (!database?.databaseName) throw new Error('Tenant database required')
  return closeRecords(database, settings || (await getAttendanceSettings(database)).settings, filter, now, true)
}
export async function markAbsentEmployees(database, settings, filter = {}, now = new Date()) {
  const threshold = atTime(now, settings.checkInTime || '09:00', getTimezone(settings.timezone))
  if (!threshold || now.getTime() < threshold.getTime() + (settings.absentThresholdMinutes ?? 60) * 60000) return { marked: 0 }
  return processAbsenceDate({ database, date: now, companyId: filter.company || undefined, onlyUnassigned: filter.company === null, calendar: { timezone: getTimezone(settings.timezone), workingDays: settings.workingDays }, sendNotifications: true })
}
export async function processNotificationsForContext(database, settings, filter = {}, now = new Date()) {
  const timezone = getTimezone(settings.timezone)
  const triggered = []
  const checkIn = atTime(now, settings.checkInTime || '09:00', timezone)
  const checkOut = atTime(now, settings.checkOutTime || '18:00', timezone)
  if (settings.notifications?.pushNotifications !== false) {
    if (checkIn && sameMinute(now, new Date(checkIn.getTime() - 15 * 60000))) triggered.push({ type: 'pre-office', ...await sendPreOfficeNotifications(database, settings, filter, now) })
    if (sameMinute(now, checkOut)) triggered.push({ type: 'work-off', ...await sendWorkOffNotifications(database, settings, filter, now) })
    if (checkOut && sameMinute(now, new Date(checkOut.getTime() + 30 * 60000))) triggered.push({ type: 'overtime-check', ...await sendOvertimeCheckNotifications(database, settings, filter, now) })
    const day = getDayNameInTimezone(now, timezone)
    for (const item of settings.breakTimings || []) {
      if (!item.isActive || (item.days?.length && !item.days.includes(day))) continue
      if (sameMinute(now, atTime(now, item.startTime, timezone))) triggered.push({ type: 'break-start', ...await sendBreakStartNotifications(database, item.name, settings, filter, now) })
      if (sameMinute(now, atTime(now, item.endTime, timezone))) triggered.push({ type: 'break-end', ...await sendBreakEndNotifications(database, item.name, settings, filter, now) })
    }
  }
  for (const [type, operation] of [['auto-checkout', processAutoCheckouts], ['mark-absent', markAbsentEmployees], ['past-day-auto-correction', processPastDayIncompleteAttendance]]) {
    const result = await operation(database, settings, filter, now)
    if (result.processed || result.marked) triggered.push({ type, ...result })
  }
  return triggered
}
export async function checkAndTriggerNotifications() {
  const system = await getFirestoreSystemDatabase({ queryFields: { tenantcompanies: ['isActive'] } })
  const tenants = await listAttendanceRecords(system, 'tenantcompanies', [{ field: 'isActive', operator: '==', value: true }])
  const triggered = [], errors = []
  for (const tenant of tenants.filter(t => t.isSetupComplete && ['active', 'trial'].includes(t.serviceStatus))) {
    try {
      const database = await getAttendanceStore(tenant.databaseName)
      const { settings } = await getAttendanceSettings(database)
      triggered.push(...await processNotificationsForContext(database, settings, { company: null }))
      const companies = await listAttendanceRecords(database, 'companies')
      for (const company of companies) {
        const configured = { ...settings, ...company.workingHours, breakTimings: company.breakTimings || settings.breakTimings || [], timezone: getTimezone(company.timezone || settings.timezone) }
        triggered.push(...await processNotificationsForContext(database, configured, { company: company._id }))
      }
    } catch (error) { errors.push({ tenantId: tenant._id, error: error.message }) }
  }
  return { triggered, errors }
}
export async function recoverAttendanceDay(database, targetDate, { includeBacklog = false, dryRun = false, skipRectification = false } = {}) {
  const { settings: defaults, company: firstCompany } = await getAttendanceSettings(database)
  const fallback = { ...defaults, ...firstCompany.workingHours, breakTimings: firstCompany.breakTimings || defaults.breakTimings || [], timezone: getTimezone(firstCompany.timezone || defaults.timezone) }
  const range = getAttendanceDayRange(targetDate, fallback.timezone)
  const filters = [{ field: 'date', operator: '<=', value: range.end }]
  if (!includeBacklog) filters.push({ field: 'date', operator: '>=', value: range.start })
  const records = await listAttendanceRecords(database, 'attendances', filters)
  const result = { processed: 0, rectified: 0, alreadyCorrect: 0, notified: 0, errors: [], dryRun }
  for (const record of records) {
    if (!record.checkIn || (record.checkOut && (skipRectification || new Date(record.date) < range.start))) continue
    const employee = await database.get('employees', attendanceId(record.employee))
    const company = employee?.company ? await database.get('companies', attendanceId(employee.company)) : null
    const settings = company ? { ...defaults, ...company.workingHours, breakTimings: company.breakTimings || defaults.breakTimings || [], timezone: getTimezone(company.timezone || defaults.timezone) } : fallback
    try {
      const operation = await database.transaction(async tx => {
        const current = await tx.get('attendances', record._id)
        const requests = !record.checkOut ? (await tx.list('overtimerequests', { filters: [{ field: 'attendance', operator: '==', value: record._id }], limit: 40, requireComplete: true })).records : []
        if (!current?.checkIn) return null
        if (!current.checkOut && current.status === 'in-progress') {
          const checkout = resolveScheduledCheckout({ attendanceDate: current.date, checkIn: current.checkIn, checkOutTime: settings.checkOutTime || '18:00', timezone: settings.timezone })
          const next = finishAttendance(current, checkout, settings, { checkOutStatus: 'auto-checkout', autoCheckedOut: true, autoCheckoutReason: 'midnight_cutoff', autoCheckoutAt: new Date() })
          if (!dryRun) {
            await tx.replace('attendances', next)
            for (const request of requests) if (request.status === 'pending') await tx.replace('overtimerequests', { ...request, status: 'auto-checkout', updatedAt: new Date() })
          }
          return 'processed'
        }
        if (!current.checkOut || skipRectification || current.source === 'correction' || current.earlyLeaveApproved || new Date(current.date) < range.start) return null
        const next = finishAttendance(current, current.checkOut, settings)
        if (next.status === current.status && Math.abs((current.workHours || 0) - next.workHours) <= .1) return 'alreadyCorrect'
        if (!dryRun) await tx.replace('attendances', { ...next, statusReason: next.statusReason + ' (Auto-rectified)' })
        return 'rectified'
      })
      if (operation) result[operation]++
      if (operation === 'processed' && !dryRun) try { if (await notify(database, employee, 'auto-checkout:' + record._id, 'Attendance automatically checked out', getRandomMessage('autoCheckout'), { attendanceId: record._id })) result.notified++ } catch {}
    } catch (error) { result.errors.push({ attendanceId: record._id, message: error.message }) }
  }
  return result
}
export default { sendPreOfficeNotifications, sendBreakStartNotifications, sendBreakEndNotifications, sendWorkOffNotifications, sendOvertimeCheckNotifications, processAutoCheckouts, markAbsentEmployees, processPastDayIncompleteAttendance, checkAndTriggerNotifications, generateAIMessage, getRandomMessage }
