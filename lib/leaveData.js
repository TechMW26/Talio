const DAY_IN_MS = 24 * 60 * 60 * 1000

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function firstDefined(source, keys) {
  for (const key of keys) {
    const value = source?.[key]
    if (value !== undefined && value !== null && value !== '') {
      return value
    }
  }
  return undefined
}

function toPlainObject(value) {
  return typeof value?.toObject === 'function' ? value.toObject() : value
}

/**
 * Return a leave balance with every field name currently consumed by the app.
 * This keeps older tenant records (allocated/used/balance) compatible with the
 * newer leave screens (totalDays/usedDays/remainingDays).
 */
export function normalizeLeaveBalance(value) {
  const balance = toPlainObject(value) || {}
  const totalDays = toFiniteNumber(firstDefined(balance, ['totalDays', 'allocated', 'total']))
  const usedDays = toFiniteNumber(firstDefined(balance, ['usedDays', 'used']))
  const pending = toFiniteNumber(balance.pending)
  const carriedForward = toFiniteNumber(balance.carriedForward)
  const storedRemaining = firstDefined(balance, ['remainingDays', 'balance', 'remaining', 'available'])
  const remainingDays = storedRemaining === undefined
    ? Math.max(0, totalDays + carriedForward - usedDays - pending)
    : Math.max(0, toFiniteNumber(storedRemaining))

  return {
    ...balance,
    totalDays,
    usedDays,
    remainingDays,
    allocated: totalDays,
    used: usedDays,
    balance: remainingDays,
    total: totalDays,
    remaining: remainingDays,
    available: remainingDays,
  }
}

export function normalizeLeaveBalances(values = []) {
  return values.map(normalizeLeaveBalance)
}

/**
 * Build mirrored persistence fields so all leave consumers stay consistent.
 */
export function buildLeaveBalanceFields({
  totalDays,
  usedDays = 0,
  pending = 0,
  carriedForward = 0,
  remainingDays,
}) {
  const normalizedTotal = Math.max(0, toFiniteNumber(totalDays))
  const normalizedUsed = Math.max(0, toFiniteNumber(usedDays))
  const normalizedPending = Math.max(0, toFiniteNumber(pending))
  const normalizedCarriedForward = Math.max(0, toFiniteNumber(carriedForward))
  const normalizedRemaining = remainingDays === undefined
    ? Math.max(0, normalizedTotal + normalizedCarriedForward - normalizedUsed - normalizedPending)
    : Math.max(0, toFiniteNumber(remainingDays))

  return {
    totalDays: normalizedTotal,
    usedDays: normalizedUsed,
    remainingDays: normalizedRemaining,
    allocated: normalizedTotal,
    used: normalizedUsed,
    pending: normalizedPending,
    balance: normalizedRemaining,
    carriedForward: normalizedCarriedForward,
  }
}

export function normalizeLeaveRequest(value) {
  const leave = toPlainObject(value) || {}
  const numberOfDays = toFiniteNumber(firstDefined(leave, ['numberOfDays', 'days']))
  const requestType = leave.requestType
    || (leave.isHalfDay ? 'half_day' : leave.workFromHome ? 'work_from_home' : 'leave')
  const requestLabel = leave.leaveType?.name
    || ({
      half_day: 'Half Day',
      work_from_home: 'Work From Home',
      early_leave: 'Early Leave',
      leave: 'Leave',
    }[requestType])

  return {
    ...leave,
    requestType,
    requestLabel,
    numberOfDays,
    days: numberOfDays,
  }
}

export function normalizeLeaveRequests(values = []) {
  return values.map(normalizeLeaveRequest)
}

export function normalizeLeaveType(value) {
  const leaveType = toPlainObject(value) || {}
  const maxDaysPerYear = toFiniteNumber(firstDefined(leaveType, ['maxDaysPerYear', 'daysPerYear']))
  const maxCarryForwardDays = toFiniteNumber(firstDefined(leaveType, ['maxCarryForwardDays', 'maxCarryForward']))
  const minDaysNotice = toFiniteNumber(firstDefined(leaveType, ['minDaysNotice', 'minNoticeDays']))

  return {
    ...leaveType,
    maxDaysPerYear,
    daysPerYear: maxDaysPerYear,
    maxCarryForwardDays,
    maxCarryForward: maxCarryForwardDays,
    minDaysNotice,
    minNoticeDays: minDaysNotice,
  }
}

export function normalizeLeaveTypes(values = []) {
  return values.map(normalizeLeaveType)
}

/**
 * Parse an HTML date input without allowing the server/client timezone to
 * change the selected calendar day.
 */
export function parseDateOnly(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return date
}

export function calculateLeaveDays(startValue, endValue, isHalfDay = false) {
  const startDate = parseDateOnly(startValue)
  const endDate = parseDateOnly(endValue)

  if (!startDate || !endDate || endDate < startDate) {
    return 0
  }

  if (isHalfDay) return 0.5
  return Math.floor((endDate.getTime() - startDate.getTime()) / DAY_IN_MS) + 1
}

export function getLocalDateInputValue(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
