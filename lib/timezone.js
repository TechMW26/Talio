/**
 * Timezone utility for company-specific timezones with IST (Indian Standard Time) as default
 * All date/time functions should use this utility to ensure consistent timezone handling
 * 
 * IMPORTANT: Always prefer company timezone when available, fall back to IST
 */

// Default timezone identifier (India - Asia/Kolkata)
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
export const IST_TIMEZONE = 'Asia/Kolkata'; // Alias for backward compatibility

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
  const tz = getTimezone(timezone);
  const dateString = new Date().toLocaleString('en-US', { timeZone: tz });
  return new Date(dateString);
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
  const inputDate = new Date(date);
  const tz = getTimezone(timezone);
  const dateString = inputDate.toLocaleString('en-US', { timeZone: tz });
  return new Date(dateString);
}

/**
 * Convert any date to IST Date object (backward compatible)
 * @param {Date|string|number} date - Date to convert
 * @returns {Date} Date object with IST time
 */
export function toISTDate(date) {
  return toTimezoneDate(date, DEFAULT_TIMEZONE);
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
  
  // Get the date in the target timezone
  const refDate = toTimezoneDate(dateRef, tz);
  
  // Set the time
  refDate.setHours(hours, minutes, 0, 0);
  
  return refDate;
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
  
  // Convert timestamp to timezone
  const timeInTz = toTimezoneDate(timestamp, tz);
  
  // Create office time on the same day
  const officeTimeDate = createTimeInTimezone(officeTime, timestamp, tz);
  
  // Calculate difference in minutes
  const diffMs = timeInTz.getTime() - officeTimeDate.getTime();
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
    actualTime: timeInTz,
    officeTime: officeTimeDate
  };
}

/**
 * Get today's date string (YYYY-MM-DD) in a specific timezone
 * @param {string} timezone - Timezone identifier
 * @returns {string} Date string in YYYY-MM-DD format
 */
export function getTodayDateString(timezone = DEFAULT_TIMEZONE) {
  const tz = getTimezone(timezone);
  return new Date().toLocaleDateString('en-CA', { timeZone: tz }); // en-CA gives YYYY-MM-DD format
}

/**
 * Get the day name (lowercase) in a specific timezone
 * @param {Date|string} date - Date to check (defaults to now)
 * @param {string} timezone - Timezone identifier
 * @returns {string} Day name (e.g., 'monday', 'tuesday')
 */
export function getDayNameInTimezone(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const tz = getTimezone(timezone);
  const dateInTz = toTimezoneDate(date, tz);
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[dateInTz.getDay()];
}

/**
 * Get IST timestamp for session IDs, unique identifiers
 * @returns {number} Timestamp in milliseconds (IST-based)
 */
export function getISTTimestamp() {
  return getCurrentISTDate().getTime();
}

/**
 * Format date to IST string (ISO format)
 * @param {Date|string|number} date - Date to format
 * @returns {string} ISO string in IST
 */
export function toISTString(date = new Date()) {
  const istDate = date ? toISTDate(date) : getCurrentISTDate();
  return istDate.toISOString();
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
  const istDate = toISTDate(date);
  istDate.setHours(0, 0, 0, 0);
  return istDate;
}

/**
 * Get end of day in IST (23:59:59)
 * @param {Date|string|number} date - Date (defaults to today)
 * @returns {Date} End of day in IST
 */
export function getISTEndOfDay(date = new Date()) {
  const istDate = toISTDate(date);
  istDate.setHours(23, 59, 59, 999);
  return istDate;
}

/**
 * Get current hour in IST (0-23)
 * @returns {number} Hour in IST
 */
export function getCurrentISTHour() {
  const istDate = getCurrentISTDate();
  return istDate.getHours();
}

/**
 * Get current time in minutes since midnight (IST)
 * @returns {number} Minutes since midnight
 */
export function getCurrentISTMinutesSinceMidnight() {
  const istDate = getCurrentISTDate();
  return istDate.getHours() * 60 + istDate.getMinutes();
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
  const now = getCurrentISTDate();
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
  return getCurrentISTDate().getDay();
}

/**
 * Get current day name in IST (lowercase: 'monday', 'tuesday', etc.)
 * @returns {string} Day name
 */
export function getCurrentISTDayName() {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[getCurrentISTDayOfWeek()];
}
