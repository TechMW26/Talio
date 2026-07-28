/**
 * Timezone utility for company-specific timezones with IST (Indian Standard Time) as default
 * All date/time functions should use this utility to ensure consistent timezone handling
 * 
 * IMPORTANT: Always prefer company timezone when available, fall back to IST
 */

// Default timezone identifier (India - Asia/Kolkata)
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
export const IST_TIMEZONE = 'Asia/Kolkata'; // Alias for backward compatibility

const NAIVE_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Get the timezone to use - company timezone or default IST
 * @param {string|object} companyOrTimezone - Company object with timezone field, or timezone string
 * @returns {string} Timezone identifier
 */
export function getTimezone(companyOrTimezone) {
  if (!companyOrTimezone) return DEFAULT_TIMEZONE;

  // If it's a string, use it directly (validate it's a valid timezone)
  if (typeof companyOrTimezone === 'string') {
    try {
      // Test if timezone is valid
      new Date().toLocaleString('en-US', { timeZone: companyOrTimezone });
      return companyOrTimezone;
    } catch {
      console.warn(`Invalid timezone: ${companyOrTimezone}, falling back to ${DEFAULT_TIMEZONE}`);
      return DEFAULT_TIMEZONE;
    }
  }

  // If it's an object (company), extract timezone
  if (typeof companyOrTimezone === 'object') {
    const tz = companyOrTimezone.timezone || companyOrTimezone?.workingHours?.timezone;
    if (tz) {
      try {
        new Date().toLocaleString('en-US', { timeZone: tz });
        return tz;
      } catch {
        console.warn(`Invalid company timezone: ${tz}, falling back to ${DEFAULT_TIMEZONE}`);
      }
    }
  }

  return DEFAULT_TIMEZONE;
}

/**
 * Get current date/time in a specific timezone
 * @param {string} timezone - Timezone identifier (defaults to IST)
 * @returns {Date} Date object representing current time in that timezone
 */
export function getCurrentDateInTimezone(timezone = DEFAULT_TIMEZONE) {
  getTimezone(timezone);
  return new Date();
}

/**
 * Get current date/time in IST (backward compatible)
 * @returns {Date} Date object with IST time
 */
export function getCurrentISTDate() {
  return getCurrentDateInTimezone(DEFAULT_TIMEZONE);
}

/**
 * Convert any date to a specific timezone
 * @param {Date|string|number} date - Date to convert
 * @param {string} timezone - Target timezone (defaults to IST)
 * @returns {Date} Date object in target timezone
 */
export function toTimezoneDate(date, timezone = DEFAULT_TIMEZONE) {
  getTimezone(timezone);
  return new Date(date);
}

/**
 * Convert any date to IST Date object (backward compatible)
 * @param {Date|string|number} date - Date to convert
 * @returns {Date} Date object with IST time
 */
export function toISTDate(date) {
  return toTimezoneDate(date, DEFAULT_TIMEZONE);
}

function getTimeZoneOffsetMilliseconds(date, timezone = DEFAULT_TIMEZONE) {
  const tz = getTimezone(timezone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });

  const values = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }

  const asUtcTimestamp = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour) === 24 ? 0 : Number(values.hour),
    Number(values.minute),
    Number(values.second),
    date.getMilliseconds()
  );

  return asUtcTimestamp - date.getTime();
}

export function getDateTimePartsInTimezone(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const inputDate = new Date(date);
  if (Number.isNaN(inputDate.getTime())) {
    throw new RangeError('Invalid date')
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: getTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });
  const values = {};

  for (const part of formatter.formatToParts(inputDate)) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second,
  };
}

export function createInstantInTimezone(parts, timezone = DEFAULT_TIMEZONE) {
  const {
    year,
    month,
    day,
    hour = 0,
    minute = 0,
    second = 0,
    millisecond = 0,
  } = parts;

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);

  let zonedDate = new Date(utcGuess);
  let offsetMilliseconds = getTimeZoneOffsetMilliseconds(zonedDate, timezone);
  zonedDate = new Date(utcGuess - offsetMilliseconds);

  const adjustedOffsetMilliseconds = getTimeZoneOffsetMilliseconds(zonedDate, timezone);
  if (adjustedOffsetMilliseconds !== offsetMilliseconds) {
    zonedDate = new Date(utcGuess - adjustedOffsetMilliseconds);
  }

  return zonedDate;
}

export function parseDateTimeInTimezone(value, timezone = DEFAULT_TIMEZONE) {
  if (!value) return null;

  if (value instanceof Date) {
    return new Date(value);
  }

  if (typeof value === 'number') {
    const parsedFromNumber = new Date(value);
    return Number.isNaN(parsedFromNumber.getTime()) ? null : parsedFromNumber;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) return null;

  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(trimmedValue)) {
    const parsedWithOffset = new Date(trimmedValue);
    return Number.isNaN(parsedWithOffset.getTime()) ? null : parsedWithOffset;
  }

  const match = trimmedValue.match(NAIVE_DATE_TIME_PATTERN);
  if (match) {
    const [, year, month, day, hour, minute, second = '0', fraction = '0'] = match;
    return createInstantInTimezone({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
      millisecond: Number(fraction.padEnd(3, '0')),
    }, timezone);
  }

  const dateOnlyMatch = trimmedValue.match(DATE_ONLY_PATTERN);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return createInstantInTimezone({
      year: Number(year),
      month: Number(month),
      day: Number(day),
    }, timezone);
  }

  const parsed = new Date(trimmedValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Create a Date object for a specific time (HH:mm) on a specific date in a timezone
 * This is CRITICAL for comparing check-in times against office hours
 * @param {string} timeString - Time in HH:mm format (e.g., "09:00")
 * @param {Date|string} dateRef - Reference date (defaults to today)
 * @param {string} timezone - Timezone identifier
 * @returns {Date} Date object set to that time in that timezone
 */
export function createTimeInTimezone(timeString, dateRef = new Date(), timezone = DEFAULT_TIMEZONE) {
  const tz = getTimezone(timezone);
  const [hours, minutes] = timeString.split(':').map(Number);
  const parts = getDateTimePartsInTimezone(dateRef, tz);

  return createInstantInTimezone({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: hours,
    minute: minutes,
  }, tz);
}

/**
 * Compare a timestamp against office hours in company timezone
 * @param {Date} timestamp - The timestamp to check (e.g., check-in time)
 * @param {string} officeTime - Office time in HH:mm format (e.g., "09:00")
 * @param {string} timezone - Company timezone
 * @param {number} graceMinutes - Grace period in minutes (default 0)
 * @returns {{ status: 'early'|'on-time'|'late', minutesDiff: number }}
 */
export function compareTimeToOfficeHours(timestamp, officeTime, timezone = DEFAULT_TIMEZONE, graceMinutes = 0) {
  const tz = getTimezone(timezone);

  // Create office time on the same day
  const officeTimeDate = createTimeInTimezone(officeTime, timestamp, tz);

  // Calculate difference in minutes
  const diffMs = new Date(timestamp).getTime() - officeTimeDate.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  // Determine status
  let status;
  if (diffMinutes < 0) {
    status = 'early';
  } else if (diffMinutes <= graceMinutes) {
    status = 'on-time';
  } else {
    status = 'late';
  }

  return {
    status,
    minutesDiff: diffMinutes,
    actualTime: new Date(timestamp),
    officeTime: officeTimeDate
  };
}

/**
 * Get today's date string (YYYY-MM-DD) in a specific timezone
 * @param {string} timezone - Timezone identifier
 * @returns {string} Date string in YYYY-MM-DD format
 */
export function getTodayDateString(timezone = DEFAULT_TIMEZONE) {
  return getDateKeyInTimezone(new Date(), timezone);
}

/**
 * Format any instant as a calendar date key in the requested timezone.
 * Safe for date inputs and day-based API filters.
 */
export function getDateKeyInTimezone(date, timezone = DEFAULT_TIMEZONE) {
  const parts = getDateTimePartsInTimezone(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/**
 * Get the day name (lowercase) in a specific timezone
 * @param {Date|string} date - Date to check (defaults to now)
 * @param {string} timezone - Timezone identifier
 * @returns {string} Day name (e.g., 'monday', 'tuesday')
 */
export function getDayNameInTimezone(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const tz = getTimezone(timezone);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
  }).format(new Date(date)).toLowerCase();
}

/**
 * Get IST timestamp for session IDs, unique identifiers
 * @returns {number} Timestamp in milliseconds (IST-based)
 */
export function getISTTimestamp() {
  return Date.now();
}

/**
 * Format date to IST string (ISO format)
 * @param {Date|string|number} date - Date to format
 * @returns {string} ISO string in IST
 */
export function toISTString(date = new Date()) {
  const inputDate = date ? new Date(date) : new Date();
  const parts = getDateTimePartsInTimezone(inputDate, IST_TIMEZONE);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}.${String(inputDate.getMilliseconds()).padStart(3, '0')}+05:30`;
}

/**
 * Format date to locale string in IST
 * @param {Date|string|number} date - Date to format
 * @param {object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted date string
 */
export function formatISTDate(date, options = {}) {
  const inputDate = date ? new Date(date) : getCurrentISTDate();
  return inputDate.toLocaleString('en-IN', {
    timeZone: IST_TIMEZONE,
    ...options,
  });
}

/**
 * Format time only in IST
 * @param {Date|string|number} date - Date to format
 * @param {boolean} use24Hour - Use 24-hour format (default: false)
 * @returns {string} Formatted time string
 */
export function formatISTTime(date, use24Hour = false) {
  const inputDate = date ? new Date(date) : getCurrentISTDate();
  return inputDate.toLocaleTimeString('en-IN', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: !use24Hour,
  });
}

/**
 * Get start of day in IST (00:00:00)
 * @param {Date|string|number} date - Date (defaults to today)
 * @returns {Date} Start of day in IST
 */
export function getISTStartOfDay(date = new Date()) {
  return getStartOfDayInTimezone(date, IST_TIMEZONE);
}

export function getStartOfDayInTimezone(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const parts = getDateTimePartsInTimezone(date, timezone);
  return createInstantInTimezone({
    year: parts.year,
    month: parts.month,
    day: parts.day,
  }, timezone);
}

/**
 * Get end of day in IST (23:59:59)
 * @param {Date|string|number} date - Date (defaults to today)
 * @returns {Date} End of day in IST
 */
export function getISTEndOfDay(date = new Date()) {
  return getEndOfDayInTimezone(date, IST_TIMEZONE);
}

export function getEndOfDayInTimezone(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const parts = getDateTimePartsInTimezone(date, timezone);
  return createInstantInTimezone({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 23,
    minute: 59,
    second: 59,
    millisecond: 999,
  }, timezone);
}

/**
 * Get current hour in IST (0-23)
 * @returns {number} Hour in IST
 */
export function getCurrentISTHour() {
  return getDateTimePartsInTimezone(new Date(), IST_TIMEZONE).hour;
}

/**
 * Get current time in minutes since midnight (IST)
 * @returns {number} Minutes since midnight
 */
export function getCurrentISTMinutesSinceMidnight() {
  const parts = getDateTimePartsInTimezone(new Date(), IST_TIMEZONE);
  return parts.hour * 60 + parts.minute;
}

/**
 * Format date for display (human-readable IST)
 * @param {Date|string|number} date - Date to format
 * @returns {string} Formatted date (e.g., "Jan 15, 2024")
 */
export function formatISTDateShort(date) {
  return formatISTDate(date, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format date and time for display (human-readable IST)
 * @param {Date|string|number} date - Date to format
 * @returns {string} Formatted date and time
 */
export function formatISTDateTime(date) {
  return formatISTDate(date, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Get time ago string (relative to IST current time)
 * @param {Date|string|number} date - Date to compare
 * @returns {string} Time ago string (e.g., "5 mins ago")
 */
export function getISTTimeAgo(date) {
  const now = new Date();
  const pastDate = new Date(date);
  const diffMs = now - pastDate;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

  return formatISTDateShort(date);
}

/**
 * Get current day of week in IST (0=Sunday, 6=Saturday)
 * @returns {number} Day of week
 */
export function getCurrentISTDayOfWeek() {
  const dayName = getDayNameInTimezone(new Date(), IST_TIMEZONE);
  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(dayName);
}

/**
 * Get current day name in IST (lowercase: 'monday', 'tuesday', etc.)
 * @returns {string} Day name
 */
export function getCurrentISTDayName() {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[getCurrentISTDayOfWeek()];
}
