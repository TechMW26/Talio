/**
 * Browser formatting compatibility helpers.
 * Talio intentionally uses IST for every user-facing module.
 */

import { IST_TIMEZONE } from './timezone';

/**
 * Get the user's timezone from the browser
 * @returns {string} IANA timezone identifier (e.g., 'America/New_York', 'Asia/Kolkata')
 */
export function getUserTimezone() {
  return IST_TIMEZONE;
}

/**
 * Format date to user's local timezone
 * @param {Date|string|number} date - Date to format
 * @param {object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted date string in user's timezone
 */
export function formatLocalDate(date, options = {}) {
  const inputDate = date ? new Date(date) : new Date();
  return inputDate.toLocaleString(undefined, {
    timeZone: IST_TIMEZONE,
    ...options,
  });
}

/**
 * Format date and time to user's local timezone (default format)
 * @param {Date|string|number} date - Date to format
 * @returns {string} Formatted date and time string
 */
export function formatLocalDateTime(date) {
  return formatLocalDate(date, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format date only (no time) to user's local timezone
 * @param {Date|string|number} date - Date to format
 * @returns {string} Formatted date string
 */
export function formatLocalDateOnly(date) {
  return formatLocalDate(date, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format time only to user's local timezone
 * @param {Date|string|number} date - Date to format
 * @param {boolean} use24Hour - Use 24-hour format (default: false)
 * @returns {string} Formatted time string
 */
export function formatLocalTime(date, use24Hour = false) {
  return formatLocalDate(date, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !use24Hour,
  });
}

/**
 * Format date with full details including timezone
 * @param {Date|string|number} date - Date to format
 * @returns {string} Formatted date with timezone info
 */
export function formatLocalDateTimeFull(date) {
  return formatLocalDate(date, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

/**
 * Get relative time string (e.g., "2 hours ago", "just now")
 * @param {Date|string|number} date - Date to compare
 * @returns {string} Relative time string
 */
export function getRelativeTime(date) {
  const inputDate = new Date(date);
  const now = new Date();
  const diffMs = now - inputDate;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  
  return formatLocalDateOnly(date);
}

/**
 * Convert UTC date to user's local timezone
 * @param {Date|string|number} utcDate - UTC date
 * @returns {Date} Date object in user's local timezone
 */
export function utcToLocal(utcDate) {
  return new Date(utcDate);
}

/**
 * Get user's timezone offset in hours
 * @returns {number} Timezone offset in hours (e.g., -5 for EST, +5.5 for IST)
 */
export function getTimezoneOffset() {
  return 5.5;
}

/**
 * Get timezone abbreviation (e.g., 'PST', 'IST', 'GMT')
 * @returns {string} Timezone abbreviation
 */
export function getTimezoneAbbreviation() {
  return 'IST';
}
