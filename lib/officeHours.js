/**
 * Office-hours helpers used to gate productivity screenshot capture.
 * A capture is "in office hours" when the captured timestamp (interpreted in
 * the company's timezone) falls between Company.workingHours.checkInTime and
 * Company.workingHours.checkOutTime on a configured working day.
 *
 * If the company config is missing/incomplete we default to permissive
 * (allow capture) — the desktop app still respects the user's clock-in flag.
 */

import { getTimezone } from '@/lib/timezone';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function parseTimeOfDay(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function getTimezoneParts(date, timezone) {
  const tz = getTimezone(timezone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  let weekday = '';
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === 'weekday') weekday = part.value.toLowerCase();
    else if (part.type === 'hour') hour = Number(part.value);
    else if (part.type === 'minute') minute = Number(part.value);
  }
  // Intl returns 24 for midnight in some runtimes
  if (hour === 24) hour = 0;
  return { weekday, minutesOfDay: hour * 60 + minute };
}

/**
 * @param {Date|string|number} timestamp
 * @param {object} company - Tenant Company doc (or plain object)
 * @returns {{ allowed: boolean, reason?: string, weekday?: string, minutesOfDay?: number, startMinutes?: number, endMinutes?: number, timezone?: string }}
 */
export function isWithinOfficeHours(timestamp, company) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return { allowed: true, reason: 'invalid_timestamp_allow_passthrough' };
  }

  const workingHours = company?.workingHours;
  const timezone = company?.timezone || workingHours?.timezone;

  // No company config → permissive
  if (!workingHours) {
    return { allowed: true, reason: 'no_company_config' };
  }

  const startMinutes = parseTimeOfDay(workingHours.checkInTime);
  const endMinutes = parseTimeOfDay(workingHours.checkOutTime);
  if (startMinutes == null || endMinutes == null) {
    return { allowed: true, reason: 'no_office_hours' };
  }

  const { weekday, minutesOfDay } = getTimezoneParts(date, timezone);

  const workingDays = Array.isArray(workingHours.workingDays) && workingHours.workingDays.length > 0
    ? workingHours.workingDays.map((d) => String(d).toLowerCase())
    : DAY_NAMES.slice(1, 6); // Mon-Fri default

  if (!workingDays.includes(weekday)) {
    return { allowed: false, reason: 'non_working_day', weekday, minutesOfDay, startMinutes, endMinutes, timezone };
  }

  // Support overnight shifts (end < start)
  const inWindow = startMinutes <= endMinutes
    ? minutesOfDay >= startMinutes && minutesOfDay <= endMinutes
    : minutesOfDay >= startMinutes || minutesOfDay <= endMinutes;

  if (!inWindow) {
    return { allowed: false, reason: 'outside_hours', weekday, minutesOfDay, startMinutes, endMinutes, timezone };
  }

  return { allowed: true, weekday, minutesOfDay, startMinutes, endMinutes, timezone };
}
