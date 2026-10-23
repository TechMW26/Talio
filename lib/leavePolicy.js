/**
 * Pure leave policy rules shared by the balance engine, request validation and
 * unit tests: Apr–Mar fiscal year, monthly accrual from DOJ, eligibility locks,
 * notice-period LWP splitting and Earned Leave encashment.
 *
 * Keep this module dependency-free (no DB, no Next, no timezone lib) so the
 * rules stay deterministic and testable.
 */

export const DAY_IN_MS = 24 * 60 * 60 * 1000
export const HALF_DAY_DAYS = 0.5
export const FY_START_MONTH = 3 // April (0-based)
export const DEFAULT_ENCASHMENT_SALARY_FIELD = 'grossSalary'

export const LEAVE_POLICY = Object.freeze({
  CL: Object.freeze({
    code: 'CL', label: 'Casual Leave', annualDays: 7,
    accruesMonthly: true, unlockMonths: 3, carryForward: false, lapsesOnYearEnd: true,
    paid: true, requiresBalance: true, halfDayAllowed: true, isLeaveWithoutPay: false, manualAllocation: false,
  }),
  SL: Object.freeze({
    code: 'SL', label: 'Sick Leave', annualDays: 5,
    accruesMonthly: true, unlockMonths: 3, carryForward: false, lapsesOnYearEnd: true,
    paid: true, requiresBalance: true, halfDayAllowed: true, isLeaveWithoutPay: false, manualAllocation: false,
  }),
  EL: Object.freeze({
    code: 'EL', label: 'Earned Leave', annualDays: 18,
    accruesMonthly: true, unlockMonths: 6, carryForward: true, lapsesOnYearEnd: false,
    paid: true, requiresBalance: true, halfDayAllowed: true, isLeaveWithoutPay: false, manualAllocation: false,
  }),
  WL: Object.freeze({
    code: 'WL', annualDays: 0,
    accruesMonthly: false, unlockMonths: 0, carryForward: false, lapsesOnYearEnd: true,
    paid: true, requiresBalance: true, halfDayAllowed: true, isLeaveWithoutPay: false, manualAllocation: true,
  }),
  BL: Object.freeze({
    code: 'BL', annualDays: 0,
    accruesMonthly: false, unlockMonths: 0, carryForward: false, lapsesOnYearEnd: true,
    paid: true, requiresBalance: true, halfDayAllowed: true, isLeaveWithoutPay: false, manualAllocation: true,
  }),
  LWP: Object.freeze({
    code: 'LWP', label: 'Leave Without Pay', annualDays: 0,
    accruesMonthly: false, unlockMonths: 0, carryForward: false, lapsesOnYearEnd: true,
    paid: false, requiresBalance: false, halfDayAllowed: true, isLeaveWithoutPay: true, manualAllocation: false,
  }),
})

/** Stable display order for the API and every leave screen. */
export const LEAVE_TYPE_ORDER = Object.freeze(['CL', 'SL', 'EL', 'WL', 'BL', 'LWP'])

/** Canonical leave types created for tenants that do not have them yet. */
export const DEFAULT_LEAVE_TYPES = Object.freeze([
  Object.freeze({ code: 'CL', name: 'Casual Leave', maxDaysPerYear: 7, isPaid: true, carryForward: false, maxCarryForwardDays: 0, requiresDocument: false, halfDayAllowed: true }),
  Object.freeze({ code: 'SL', name: 'Sick Leave', maxDaysPerYear: 5, isPaid: true, carryForward: false, maxCarryForwardDays: 0, requiresDocument: false, halfDayAllowed: true }),
  Object.freeze({ code: 'EL', name: 'Earned Leave', maxDaysPerYear: 18, isPaid: true, carryForward: true, maxCarryForwardDays: 18, requiresDocument: false, halfDayAllowed: true }),
  Object.freeze({ code: 'LWP', name: 'Leave Without Pay', maxDaysPerYear: 0, isPaid: false, carryForward: false, maxCarryForwardDays: 0, requiresDocument: false, halfDayAllowed: true }),
])

export const ENCASHMENT_POLICY = Object.freeze({
  salaryField: DEFAULT_ENCASHMENT_SALARY_FIELD,
  daysPerMonth: 30,
  rate: 0.5,
  minServiceYears: 1,
})

const TYPE_ALIASES = Object.freeze({
  cl: 'CL', casual: 'CL', 'casual leave': 'CL',
  sl: 'SL', sick: 'SL', 'sick leave': 'SL',
  el: 'EL', earned: 'EL', 'earned leave': 'EL', annual: 'EL', 'annual leave': 'EL',
  'privilege leave': 'EL', pl: 'EL',
  lwp: 'LWP', 'leave without pay': 'LWP', 'loss of pay': 'LWP', unpaid: 'LWP',
})

const dateInput = value => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value) : null
  if (typeof value !== 'string' || !value.trim()) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  const date = iso ? new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const utcDate = (year, month, day) => new Date(Date.UTC(year, month, day))
const monthStart = date => utcDate(date.getUTCFullYear(), date.getUTCMonth(), 1)
const daysInMonth = date => utcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 0).getUTCDate()
const monthKey = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`

export function isFiscalYear(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 1900 && Number(value) <= 9998
}

/** Fiscal year start year for a date: 1 Apr 2026 – 31 Mar 2027 => 2026. */
export function fiscalYearFor(value) {
  const date = dateInput(value) || new Date()
  return date.getUTCMonth() >= FY_START_MONTH ? date.getUTCFullYear() : date.getUTCFullYear() - 1
}

export function fiscalYearRange(year) {
  if (!isFiscalYear(year)) throw new TypeError('Invalid leave year')
  const start = Number(year)
  return { start: utcDate(start, FY_START_MONTH, 1), end: utcDate(start + 1, FY_START_MONTH, 0), endExclusive: utcDate(start + 1, FY_START_MONTH, 1) }
}

export function fiscalYearLabel(year) {
  if (!isFiscalYear(year)) return ''
  return `FY ${Number(year)}-${String((Number(year) + 1) % 100).padStart(2, '0')}`
}

export function currentFiscalYear(now = new Date()) {
  return fiscalYearFor(now)
}

/** Calendar-month addition with end-of-month clamping (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsClamped(value, months) {
  const date = dateInput(value)
  const offset = Number(months)
  if (!date || !Number.isInteger(offset)) return null
  const target = utcDate(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)
  const day = Math.min(date.getUTCDate(), daysInMonth(target))
  return utcDate(target.getUTCFullYear(), target.getUTCMonth(), day)
}

/** First date the leave type becomes usable (DOJ + unlock months, day ignored for probation). */
export function unlockDateFor(joiningDate, months) {
  if (!Number.isFinite(Number(months)) || Number(months) <= 0) return null
  return addMonthsClamped(joiningDate, Number(months))
}

export function isLeaveUnlocked({ joiningDate, policy, onDate = new Date() }) {
  const unlock = unlockDateFor(joiningDate, policy?.unlockMonths || 0)
  if (!unlock) return true
  const date = dateInput(onDate)
  return Boolean(date) && date.getTime() >= unlock.getTime()
}

/** Whole years of service completed on `onDate`. */
export function serviceCompletedYears(joiningDate, onDate = new Date()) {
  const joined = dateInput(joiningDate)
  const date = dateInput(onDate)
  if (!joined || !date || date < joined) return 0
  let years = date.getUTCFullYear() - joined.getUTCFullYear()
  const anniversary = addMonthsClamped(joined, years * 12)
  if (anniversary && anniversary > date) years -= 1
  return Math.max(0, years)
}

export function monthlyCreditDays(annualDays) {
  const annual = Number(annualDays)
  return Number.isFinite(annual) && annual > 0 ? annual / 12 : 0
}

/** Round a running total down to the nearest 0.5 day. */
export function roundDownHalf(days) {
  const value = Number(days)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor((value + 1e-9) * 2) / 2
}

/** Resolve the rule set for a stored leave type (by code, name, else its own entitlement). */
export function resolveLeavePolicy(type) {
  const code = String(type?.code || '').trim()
  const name = String(type?.name || '').trim().toLowerCase()
  const key = LEAVE_POLICY[code.toUpperCase()]
    ? code.toUpperCase()
    : TYPE_ALIASES[code.toLowerCase()] || TYPE_ALIASES[name] || null
  const base = key ? LEAVE_POLICY[key] : null
  const annualDays = base
    ? base.annualDays
    : Math.max(0, Number(type?.maxDaysPerYear ?? type?.daysPerYear ?? 0) || 0)

  return {
    code: key || code.toUpperCase() || null,
    label: String(type?.name || '').trim() || base?.label || code || 'Leave',
    annualDays,
    accruesMonthly: base ? base.accruesMonthly : annualDays > 0,
    unlockMonths: base ? base.unlockMonths : 0,
    carryForward: base ? base.carryForward : Boolean(type?.carryForward),
    lapsesOnYearEnd: base ? base.lapsesOnYearEnd : !type?.carryForward,
    paid: base ? base.paid : type?.isPaid !== false,
    requiresBalance: base ? base.requiresBalance : true,
    halfDayAllowed: base ? base.halfDayAllowed : type?.halfDayAllowed !== false,
    isLeaveWithoutPay: base ? base.isLeaveWithoutPay : false,
    manualAllocation: base ? Boolean(base.manualAllocation) : false,
  }
}

/**
 * Approved + pending LWP days keyed by calendar month ("YYYY-MM").
 * A request spanning months distributes its recorded days evenly across its
 * calendar span so no month is over- or under-credited.
 */
export function summarizeLwpDaysByMonth(requests = []) {
  const totals = new Map()
  for (const request of Array.isArray(requests) ? requests : []) {
    const days = Number(request?.numberOfDays ?? request?.days)
    const start = dateInput(request?.startDate)
    const end = dateInput(request?.endDate) || start
    if (!Number.isFinite(days) || days <= 0 || !start || !end || end < start) continue
    const span = Math.round((end.getTime() - start.getTime()) / DAY_IN_MS) + 1
    if (span > 366) continue
    const perDay = days / span
    for (let index = 0; index < span; index += 1) {
      const key = monthKey(new Date(start.getTime() + index * DAY_IN_MS))
      totals.set(key, (totals.get(key) || 0) + perDay)
    }
  }
  return Object.fromEntries([...totals].map(([key, value]) => [key, Math.round(value * 100) / 100]))
}

/**
 * Accrued days for one fiscal year, computed on the fly from the joining date.
 *
 * - Each month credits `annualDays / 12` on the 1st.
 * - The joining month credits only the employed days of that month (pro rata).
 * - LWP days do not accrue: they are removed from that month's employed days.
 * - The running total is rounded down to the nearest 0.5 day.
 */
export function accruedDays({ annualDays, joiningDate, asOf = new Date(), fiscalYear, lwpDaysByMonth = {} } = {}) {
  const monthly = monthlyCreditDays(annualDays)
  const year = isFiscalYear(fiscalYear) ? Number(fiscalYear) : fiscalYearFor(asOf)
  const { start, end } = fiscalYearRange(year)
  const asOfDate = dateInput(asOf)
  if (!monthly || !asOfDate) return 0

  const joined = dateInput(joiningDate)
  const effectiveStart = joined && joined > start ? joined : start
  const lastDay = asOfDate < end ? asOfDate : end
  if (lastDay < effectiveStart) return 0

  const firstMonth = monthStart(effectiveStart)
  const lastMonth = monthStart(lastDay)
  let total = 0
  let guard = 0

  for (let cursor = firstMonth; cursor <= lastMonth && guard < 24; cursor = addMonthsClamped(cursor, 1), guard += 1) {
    const monthDays = daysInMonth(cursor)
    const monthEnd = utcDate(cursor.getUTCFullYear(), cursor.getUTCMonth(), monthDays)
    const isJoiningMonth = Boolean(joined) && monthKey(joined) === monthKey(cursor)
    const coveredStart = isJoiningMonth && joined > cursor ? joined : cursor
    const coveredDays = Math.round((monthEnd.getTime() - coveredStart.getTime()) / DAY_IN_MS) + 1
    if (coveredDays <= 0) continue
    const excluded = Math.max(0, Number(lwpDaysByMonth?.[monthKey(cursor)]) || 0)
    const creditedDays = Math.min(coveredDays, Math.max(0, coveredDays - excluded))
    total += monthly * (creditedDays / monthDays)
  }

  return roundDownHalf(total)
}

export function accruedLeave({ policy, employee, asOf = new Date(), fiscalYear, lwpDaysByMonth } = {}) {
  if (!policy?.accruesMonthly) return 0
  return accruedDays({
    annualDays: policy.annualDays,
    joiningDate: employee?.dateOfJoining,
    asOf,
    fiscalYear,
    lwpDaysByMonth,
  })
}

export function countCalendarDays(start, end) {
  const from = dateInput(start)
  const to = dateInput(end)
  if (!from || !to || to < from) return 0
  return Math.round((to.getTime() - from.getTime()) / DAY_IN_MS) + 1
}

/** Notice period (resignation → last working day) for an employee record. */
export function noticeWindow(employee) {
  const offboarding = employee?.lifecycle?.offboarding || {}
  const resignationDate = dateInput(offboarding.resignationDate)
  const lastWorkingDay = dateInput(offboarding.lastWorkingDay || offboarding.lastWorkingDate || employee?.dateOfLeaving)
  if (!resignationDate || !lastWorkingDay || lastWorkingDay < resignationDate) return null
  return { resignationDate, lastWorkingDay }
}

/**
 * Split a request that overlaps the notice period. Days inside
 * [resignationDate, lastWorkingDay] become unpaid (LWP); everything before the
 * notice start stays on the selected leave type. Days after the last working
 * day are never converted into leave: they are excluded from the segments and
 * reported through `beyondLastWorkingDay` so callers can reject the request.
 * `countDays` keeps the caller's working-day rules (the leave module skips
 * Sundays).
 */
export function splitByNoticePeriod({ start, end, resignationDate, lastWorkingDay, countDays = countCalendarDays } = {}) {
  const from = dateInput(start)
  const to = dateInput(end)
  if (!from || !to || to < from) return { segments: [], crossesNotice: false, beyondLastWorkingDay: false }

  const windowStart = dateInput(resignationDate)
  const windowEnd = dateInput(lastWorkingDay)
  const beyondLastWorkingDay = Boolean(windowEnd) && to.getTime() > windowEnd.getTime()
  const allowedEnd = beyondLastWorkingDay ? windowEnd : to

  if (!windowStart || !windowEnd || windowEnd < windowStart || allowedEnd < windowStart || from > windowEnd) {
    const days = countDays(from, allowedEnd)
    return {
      segments: days > 0 ? [{ segment: 'leave', start: from, end: allowedEnd, days }] : [],
      crossesNotice: false,
      beyondLastWorkingDay,
    }
  }

  const segments = []
  const push = (segment, segmentStart, segmentEnd) => {
    if (!segmentStart || !segmentEnd || segmentEnd < segmentStart) return
    const days = countDays(segmentStart, segmentEnd)
    if (days > 0) segments.push({ segment, start: segmentStart, end: segmentEnd, days })
  }

  const dayBeforeNotice = new Date(windowStart.getTime() - DAY_IN_MS)
  push('leave', from, allowedEnd < dayBeforeNotice ? allowedEnd : dayBeforeNotice)
  push('lwp', from > windowStart ? from : windowStart, allowedEnd < windowEnd ? allowedEnd : windowEnd)

  return { segments, crossesNotice: segments.some(segment => segment.segment === 'lwp'), beyondLastWorkingDay }
}

/**
 * Leave cannot be taken after employment ends. Returns null when the request is
 * within the employee's employment, otherwise a structured violation.
 */
export function noticeWindowViolation({ start, end, lastWorkingDay } = {}) {
  const from = dateInput(start)
  const to = dateInput(end)
  const windowEnd = dateInput(lastWorkingDay)
  if (!from || !to || !windowEnd || to.getTime() <= windowEnd.getTime()) return null
  return { reason: 'after_last_working_day', lastWorkingDay: windowEnd, start: from, end: to }
}

/**
 * Decide which records a submission creates.
 *
 * - Any date after the last working day produces `violation` and no segments;
 *   callers must reject the whole request (dates are never trimmed).
 * - Leave that crosses the notice start is split into paid + LWP segments.
 * - Leave entirely inside the notice period is a single LWP segment.
 * - WFH / early-leave requests (`consumesBalance: false`) are left untouched.
 */
export function planNoticeSegments({
  start,
  end,
  isHalfDay = false,
  consumesBalance = true,
  numberOfDays,
  employee,
  countDays = countCalendarDays,
} = {}) {
  const from = dateInput(start)
  const to = dateInput(end)
  const windowStart = noticeWindow(employee)
  const lastWorkingDay = windowStart?.lastWorkingDay || dateInput(employee?.dateOfLeaving)
  const fallbackDays = Number.isFinite(Number(numberOfDays)) ? Number(numberOfDays) : countDays(from, to)
  const single = days => [{ segment: 'leave', start: from, end: to, days }]

  if (consumesBalance && lastWorkingDay) {
    const violation = noticeWindowViolation({ start: from, end: to, lastWorkingDay })
    if (violation) return { segments: [], violation, window: windowStart }
  }

  if (!consumesBalance || !from || !to) return { segments: single(fallbackDays), violation: null, window: windowStart }

  if (isHalfDay) {
    const insideNotice = Boolean(windowStart)
      && from.getTime() >= windowStart.resignationDate.getTime()
      && from.getTime() <= windowStart.lastWorkingDay.getTime()
    return { segments: [{ segment: insideNotice ? 'lwp' : 'leave', start: from, end: to, days: fallbackDays }], violation: null, window: windowStart }
  }

  const segments = windowStart
    ? splitByNoticePeriod({ start: from, end: to, ...windowStart, countDays }).segments
    : []
  return { segments: segments.length ? segments : single(fallbackDays), violation: null, window: windowStart }
}

/** Salary used for encashment: only the configured field, never a fallback. */
export function encashmentSalaryValue(employee, salaryField = DEFAULT_ENCASHMENT_SALARY_FIELD) {
  const raw = employee?.salary?.[salaryField]
  if (raw === null || raw === undefined || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** round(days × salary / 30 × 0.5); null when salary or days are unavailable. */
export function encashmentAmount({ days, salary, daysPerMonth = ENCASHMENT_POLICY.daysPerMonth, rate = ENCASHMENT_POLICY.rate } = {}) {
  const leaveDays = Number(days)
  if (salary === null || salary === undefined || salary === '') return null
  const monthlySalary = Number(salary)
  if (!Number.isFinite(leaveDays) || leaveDays <= 0) return null
  if (!Number.isFinite(monthlySalary) || monthlySalary <= 0) return null
  return Math.round(leaveDays * (monthlySalary / daysPerMonth) * rate)
}

export function isEncashmentEligible({ joiningDate, fiscalYearEnd, minServiceYears = ENCASHMENT_POLICY.minServiceYears } = {}) {
  const end = dateInput(fiscalYearEnd)
  if (!end) return false
  return serviceCompletedYears(joiningDate, end) >= Number(minServiceYears)
}

/** Shared wording for the submit rejection and the Apply-page preview. */
export function noticeViolationMessage(lastWorkingDay) {
  const date = dateInput(lastWorkingDay)
  const label = date
    ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : ''
  return `Your last working day is ${label}. Leave cannot include any date after your last working day.`
}

/** Encashment for a fiscal year is paid in June–August after the 31 March close. */
export function encashmentPayoutWindow(fiscalYear) {
  if (!isFiscalYear(fiscalYear)) return null
  const payoutYear = Number(fiscalYear) + 1
  return { from: utcDate(payoutYear, 5, 1), to: utcDate(payoutYear, 7, 31) }
}
