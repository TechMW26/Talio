import { parseDateOnly } from './leaveData'

const DAY_IN_MS = 24 * 60 * 60 * 1000

function holidayKey(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  }
  if (typeof value === 'string') {
    const parsed = parseDateOnly(value.slice(0, 10))
    return parsed ? parsed.toISOString().slice(0, 10) : null
  }
  if (value && typeof value === 'object') {
    const date = value.date || value.startDate || value.day
    return date ? holidayKey(date) : null
  }
  return null
}

/**
 * "1 day" / "2 days" — keeps every leave count grammatical.
 */
export function formatLeaveDays(value) {
  const days = Number(value)
  if (!Number.isFinite(days)) return '0 days'
  return `${days} ${Math.abs(days) === 1 ? 'day' : 'days'}`
}

/**
 * Inclusive full-day leave count. Sundays are skipped so a Monday-Friday
 * request counts as five days. Saturdays currently count as working days.
 *
 * TODO: confirm whether Saturday and sandwich-leave rules vary by tenant before
 * making them configurable. Holiday values may be ISO date strings, Dates, or
 * records containing `date`, `startDate`, or `day`.
 */
export function countLeaveDays(startValue, endValue, holidays = []) {
  const startDate = parseDateOnly(startValue)
  const endDate = parseDateOnly(endValue)

  if (!startDate || !endDate || endDate < startDate) return 0
  if ((endDate.getTime() - startDate.getTime()) / DAY_IN_MS > 366) return 0

  const holidayKeys = new Set((Array.isArray(holidays) ? holidays : []).map(holidayKey).filter(Boolean))
  let days = 0
  for (let time = startDate.getTime(); time <= endDate.getTime(); time += DAY_IN_MS) {
    const date = new Date(time)
    if (date.getUTCDay() === 0) continue
    if (holidayKeys.has(date.toISOString().slice(0, 10))) continue
    days++
  }
  return days
}
