/**
 * Attendance Shrinkage Calculator
 * 
 * Shrinkage = (Total Logged Hours - Productive Hours) / Total Logged Hours * 100
 * 
 * This module calculates effective work hours by accounting for:
 * - Break times (lunch, tea, etc.)
 * - Meeting times
 * - Buffer time for transitions
 */

/**
 * Calculate total break duration in minutes between check-in and check-out
 * Only counts breaks that fall within the working period
 */
export function calculateBreakDuration(breakTimings, checkInTime, checkOutTime) {
  // Ensure breakTimings is a valid array before iterating
  // Ensure breakTimings is an array
  if (!breakTimings || !Array.isArray(breakTimings) || !Array.isArray(breakTimings) || breakTimings.length === 0) {
    return 0
  }

  const checkIn = new Date(checkInTime)
  const checkOut = new Date(checkOutTime)
  const dayOfWeek = checkIn.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()

  let totalBreakMinutes = 0

  for (const breakTiming of breakTimings) {
    // Skip inactive breaks
    if (!breakTiming.isActive) continue

    // Check if break applies to this day
    if (breakTiming.days && breakTiming.days.length > 0 && !breakTiming.days.includes(dayOfWeek)) {
      continue
    }

    // Parse break start and end times
    const [startHour, startMin] = breakTiming.startTime.split(':').map(Number)
    const [endHour, endMin] = breakTiming.endTime.split(':').map(Number)

    const breakStart = new Date(checkIn)
    breakStart.setHours(startHour, startMin, 0, 0)

    const breakEnd = new Date(checkIn)
    breakEnd.setHours(endHour, endMin, 0, 0)

    // Calculate overlap between break time and work period
    const effectiveBreakStart = breakStart < checkIn ? checkIn : breakStart
    const effectiveBreakEnd = breakEnd > checkOut ? checkOut : breakEnd

    if (effectiveBreakEnd > effectiveBreakStart) {
      const breakDuration = (effectiveBreakEnd - effectiveBreakStart) / (1000 * 60)
      totalBreakMinutes += breakDuration
    }
  }

  return totalBreakMinutes
}

/**
 * Calculate shrinkage percentage
 * Shrinkage represents the percentage of logged time that is non-productive
 */
export function calculateShrinkage(totalLoggedMinutes, breakMinutes, otherDeductionsMinutes = 0) {
  if (totalLoggedMinutes <= 0) return 0

  const nonProductiveMinutes = breakMinutes + otherDeductionsMinutes
  const shrinkage = (nonProductiveMinutes / totalLoggedMinutes) * 100

  return Math.min(shrinkage, 100) // Cap at 100%
}

/**
 * Calculate effective (productive) work hours using shrinkage method
 * 
 * @param {Date} checkInTime - Employee check-in time
 * @param {Date} checkOutTime - Employee check-out time
 * @param {Array} breakTimings - Array of break timing objects from company settings
 * @param {Object} options - Additional options
 * @param {number} options.transitionBuffer - Buffer minutes for transitions (default: 5 per break)
 * @returns {Object} - Work hours calculation result
 */
export function calculateEffectiveWorkHours(checkInTime, checkOutTime, breakTimings = [], options = {}) {
  const checkIn = new Date(checkInTime)
  const checkOut = new Date(checkOutTime)

  // Ensure breakTimings is an array
  const safeBreakTimings = Array.isArray(breakTimings) ? breakTimings : []


  const safeBreakTimings = Array.isArray(breakTimings) ? breakTimings : []

  // Total logged time in minutes
  const totalLoggedMinutes = (checkOut - checkIn) / (1000 * 60)

  // Calculate break duration
  const breakMinutes = calculateBreakDuration(safeBreakTimings, checkIn, checkOut)

  // Add transition buffer (5 minutes per break by default)
  const activeBreaks = safeBreakTimings.filter(b => b.isActive).length
  const transitionBuffer = options.transitionBuffer || (activeBreaks * 5)

  // Total deductions
  const totalDeductions = breakMinutes + transitionBuffer

  // Effective work minutes
  const effectiveWorkMinutes = Math.max(0, totalLoggedMinutes - totalDeductions)

  // Convert to hours
  const totalLoggedHours = totalLoggedMinutes / 60
  const effectiveWorkHours = effectiveWorkMinutes / 60

  // Calculate shrinkage percentage
  const shrinkagePercentage = calculateShrinkage(totalLoggedMinutes, totalDeductions)

  return {
    totalLoggedHours: parseFloat(totalLoggedHours.toFixed(2)),
    totalLoggedMinutes: Math.round(totalLoggedMinutes),
    breakMinutes: Math.round(breakMinutes),
    transitionBuffer: Math.round(transitionBuffer),
    totalDeductions: Math.round(totalDeductions),
    effectiveWorkMinutes: Math.round(effectiveWorkMinutes),
    effectiveWorkHours: parseFloat(effectiveWorkHours.toFixed(2)),
    shrinkagePercentage: parseFloat(shrinkagePercentage.toFixed(2))
  }
}

/**
 * Determine attendance status based on effective work hours and company settings
 * 
 * @param {number} effectiveWorkHours - Calculated effective work hours
 * @param {Object} settings - Company settings
 * @returns {Object} - Status and reasoning
 */
export function determineAttendanceStatus(effectiveWorkHours, settings = {}) {
  const fullDayHours = settings.fullDayHours || 8
  const halfDayHours = settings.halfDayHours || 4

  // 50% rule: If employee completed 50% or more of required hours, they pass the half-day mark
  const halfDayThreshold = fullDayHours * 0.5
  const fullDayThreshold = fullDayHours * 0.9 // 90% threshold for full day (to account for minor variations)

  let status = 'absent'
  let reason = ''

  if (effectiveWorkHours >= fullDayThreshold) {
    status = 'present'
    reason = `Worked ${effectiveWorkHours.toFixed(2)} hours (≥${fullDayThreshold}h threshold for full day)`
  } else if (effectiveWorkHours >= halfDayThreshold) {
    status = 'half-day'
    reason = `Worked ${effectiveWorkHours.toFixed(2)} hours (≥${halfDayThreshold}h = 50% of ${fullDayHours}h)`
  } else {
    status = 'absent'
    reason = `Worked only ${effectiveWorkHours.toFixed(2)} hours (<${halfDayThreshold}h = 50% threshold)`
  }

  return {
    status,
    reason,
    thresholds: {
      halfDay: halfDayThreshold,
      fullDay: fullDayThreshold,
      required: fullDayHours
    }
  }
}

/**
 * Check if current time is within a break period
 */
export function isBreakTime(breakTimings, currentTime = new Date()) {
  if (!breakTimings || breakTimings.length === 0) {
    return { isBreak: false, breakName: null, breakEnd: null }
  }

  const dayOfWeek = currentTime.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()

  for (const breakTiming of breakTimings) {
    if (!breakTiming.isActive) continue
    if (breakTiming.days && breakTiming.days.length > 0 && !breakTiming.days.includes(dayOfWeek)) {
      continue
    }

    const [startHour, startMin] = breakTiming.startTime.split(':').map(Number)
    const [endHour, endMin] = breakTiming.endTime.split(':').map(Number)

    const breakStart = new Date(currentTime)
    breakStart.setHours(startHour, startMin, 0, 0)

    const breakEnd = new Date(currentTime)
    breakEnd.setHours(endHour, endMin, 0, 0)

    if (currentTime >= breakStart && currentTime < breakEnd) {
      return {
        isBreak: true,
        breakName: breakTiming.name,
        breakEnd: breakEnd,
        remainingMinutes: Math.round((breakEnd - currentTime) / (1000 * 60))
      }
    }
  }

  return { isBreak: false, breakName: null, breakEnd: null }
}

/**
 * Get upcoming break
 */
export function getUpcomingBreak(breakTimings, currentTime = new Date()) {
  if (!breakTimings || breakTimings.length === 0) {
    return null
  }

  const dayOfWeek = currentTime.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
  let upcomingBreak = null
  let minDiff = Infinity

  for (const breakTiming of breakTimings) {
    if (!breakTiming.isActive) continue
    if (breakTiming.days && breakTiming.days.length > 0 && !breakTiming.days.includes(dayOfWeek)) {
      continue
    }

    const [startHour, startMin] = breakTiming.startTime.split(':').map(Number)

    const breakStart = new Date(currentTime)
    breakStart.setHours(startHour, startMin, 0, 0)

    const diff = breakStart - currentTime

    if (diff > 0 && diff < minDiff) {
      minDiff = diff
      upcomingBreak = {
        ...breakTiming,
        startsIn: Math.round(diff / (1000 * 60))
      }
    }
  }

  return upcomingBreak
}

export default {
  calculateBreakDuration,
  calculateShrinkage,
  calculateEffectiveWorkHours,
  determineAttendanceStatus,
  isBreakTime,
  getUpcomingBreak
}
