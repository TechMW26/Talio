import { getDateKeyInTimezone, parseDateTimeInTimezone } from '@/lib/timezone'

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function previousDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const previous = new Date(Date.UTC(year, month - 1, day - 1))
  return previous.toISOString().slice(0, 10)
}

export function getAttendanceDayRange(dateOrKey, timezone) {
  const dateKey = typeof dateOrKey === 'string' && DATE_KEY_PATTERN.test(dateOrKey)
    ? dateOrKey
    : getDateKeyInTimezone(dateOrKey, timezone)

  return {
    dateKey,
    start: parseDateTimeInTimezone(`${dateKey}T00:00:00.000`, timezone),
    end: parseDateTimeInTimezone(`${dateKey}T23:59:59.999`, timezone),
  }
}

export function buildOpenAttendanceQuery({ targetDateStart, targetDateEnd, includeBacklog = false }) {
  return {
    date: includeBacklog
      ? { $lte: targetDateEnd }
      : { $gte: targetDateStart, $lte: targetDateEnd },
    checkIn: { $exists: true, $ne: null },
    $or: [{ checkOut: null }, { checkOut: { $exists: false } }],
    status: 'in-progress',
  }
}

export function resolveScheduledCheckout({ attendanceDate, checkIn, checkOutTime = '18:00', timezone }) {
  const dateKey = getDateKeyInTimezone(attendanceDate, timezone)
  const scheduled = parseDateTimeInTimezone(`${dateKey}T${checkOutTime}:00`, timezone)
  if (!scheduled) return null

  const checkedInAt = new Date(checkIn)
  return checkedInAt > scheduled
    ? new Date(checkedInAt.getTime() + 60_000)
    : scheduled
}
