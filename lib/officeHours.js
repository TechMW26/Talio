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

export const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const DEFAULT_WORKING_DAYS = DAY_NAMES.slice(1, 6); // Mon-Fri

// Short forms accepted from older configs and third-party imports.
const DAY_ALIASES = {
  sun: 'sunday', mon: 'monday', tue: 'tuesday', tues: 'tuesday', wed: 'wednesday',
  thu: 'thursday', thur: 'thursday', thurs: 'thursday', fri: 'friday', sat: 'saturday',
};

function toDayName(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= 6 ? DAY_NAMES[value] : null;
  if (typeof value === 'string') {
    const day = value.trim().toLowerCase();
    if (DAY_NAMES.includes(day)) return day;
    if (DAY_ALIASES[day]) return DAY_ALIASES[day];
    return /^[0-6]$/.test(day) ? DAY_NAMES[Number(day)] : null;
  }
  if (value && typeof value === 'object') return toDayName(value.day ?? value.name ?? value.value);
  return null;
}

/**
 * Normalize a company's working-days config into lowercase day names.
 * Accepts day names ("saturday"), numbers (6), abbreviations ("sat") and
 * `{ day }` style records so stored formats never silently drop a working day.
 * @returns {string[]} day names in Sunday-first order (empty when nothing is valid)
 */
export function normalizeWorkingDays(value) {
  const entries = Array.isArray(value) ? value : typeof value === 'string' || typeof value === 'number' ? [value] : [];
  const selected = new Set(entries.map(toDayName).filter(Boolean));
  return DAY_NAMES.filter((day) => selected.has(day));
}

/** First source that resolves to at least one valid working day, else Mon-Fri. */
export function resolveWorkingDays(...sources) {
  for (const source of sources) {
    const days = normalizeWorkingDays(source);
    if (days.length) return days;
  }
  return [...DEFAULT_WORKING_DAYS];
}

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

  const workingDays = resolveWorkingDays(workingHours.workingDays);

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
