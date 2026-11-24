import { buildLeaveBalanceFields, normalizeLeaveBalance, parseDateOnly } from './leaveData'
import { EMPLOYED_STATUSES, ensureEmployeeLeaveBalances, leaveBalanceFilters, leaveBalanceId } from './leaveAllocation.server'
import { buildLeaveTypeIndex, loadLeaveTypes } from './leaveTypes.server'
import { LEAVE_TYPE_ORDER, accruedDays, fiscalYearLabel, fiscalYearRange, noticeViolationMessage, noticeWindow, planNoticeSegments, resolveLeavePolicy, summarizeLwpDaysByMonth, unlockDateFor } from './leavePolicy'
import { countLeaveDays } from './leaveDays'
import { collectFirestorePages, readFirestoreReferences } from './platform/firestoreQueries.server'

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const managers = new Set(['admin', 'super_admin', 'hr'])
const idOf = value => String(value?._id || value || '')
const pick = (record, fields) => record ? Object.fromEntries(['_id', ...fields].filter(key => record[key] !== undefined).map(key => [key, record[key]])) : null
export function validateLeaveYear(year) {
  if (!Number.isInteger(year) || year < 1900 || year > 9998) fail('Invalid leave year')
}
function validateId(id) { if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) fail('Invalid employee or leave type ID') }

function requestDays(record) {
  const numberOfDays = Number(record?.numberOfDays)
  if (Number.isFinite(numberOfDays) && numberOfDays > 0) return numberOfDays
  const days = Number(record?.days)
  return Number.isFinite(days) && days > 0 ? days : 0
}

/** Aggregate the single source of truth for requests in a leave year. */
export function summarizeLeaveBalanceRecords({ employeeId, year, types = [], balances = [], requests = [] }) {
  const index = buildLeaveTypeIndex(types)
  const entries = new Map()
  const entryFor = type => {
    const key = String(type._id)
    if (!entries.has(key)) entries.set(key, { type, balance: null, used: 0, pending: 0 })
    return entries.get(key)
  }

  for (const type of types) if (type?.isActive) entryFor(type)
  for (const balance of balances) {
    const type = index.resolve(balance.leaveType)
    if (type) entryFor(type).balance = balance
  }
  for (const request of requests) {
    if (!['pending', 'approved'].includes(String(request.status || '').toLowerCase())) continue
    const type = index.resolve(request.leaveType)
      || index.resolve(request.leaveTypeCode)
      || index.resolve(request.leaveTypeName)
    if (!type) continue
    const days = requestDays(request)
    if (!days) continue
    const entry = entryFor(type)
    if (String(request.status).toLowerCase() === 'approved') entry.used += days
    else entry.pending += days
  }

  return [...entries.values()]
    .filter(entry => entry.balance || entry.used || entry.pending)
    .map(({ type, balance, used, pending }) => {
      const stored = normalizeLeaveBalance(balance || {})
      const total = stored.totalDays
      const carriedForward = stored.carriedForward
      const available = Math.max(0, total + carriedForward - used - pending)
      return {
        ...(balance || {}),
        _id: balance?._id || leaveBalanceId(employeeId, type._id, year),
        employee: employeeId,
        leaveType: pick(type, ['name', 'code', 'color']),
        year,
        totalDays: total,
        usedDays: used,
        pending,
        carriedForward,
        remainingDays: available,
        allocated: total,
        total,
        used,
        remaining: available,
        available,
        balance: available,
      }
    })
    .sort((left, right) => String(left.leaveType?.name || '').localeCompare(String(right.leaveType?.name || '')))
}

/** HR-entered entitlement replaces the computed accrual; legacy auto-allocation rows do not. */
function explicitOverrideDays(balance) {
  if (!balance) return null
  const value = balance.overrideDays ?? (balance.source === 'manual' ? balance.totalDays : undefined)
  if (value === null || value === undefined || value === '') return null
  const days = Number(value)
  return Number.isFinite(days) && days >= 0 ? days : null
}

/**
 * HR tracker import for a monthly-accrual type: leave taken before Talio, the
 * employee's yearly limit from HR's sheet, and the EL carry HR already counted.
 */
function openingImportFor(balance, policy) {
  if (!balance || balance.source !== 'opening' || policy.manualAllocation || !policy.accruesMonthly) return null
  const days = value => {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? number : null
  }
  const raw = balance.openingAsOf
  const asOf = raw instanceof Date ? raw : raw?.toDate ? raw.toDate() : raw ? new Date(raw) : null
  return {
    used: days(balance.openingUsedDays) ?? 0,
    cap: days(balance.openingAllottedDays),
    carriedForward: days(balance.openingCarriedForward),
    asOf: asOf && !Number.isNaN(asOf.getTime()) ? asOf : null,
  }
}

const requestStart = request => {
  const raw = request?.startDate
  const date = raw instanceof Date ? raw : raw?.toDate ? raw.toDate() : raw ? new Date(raw) : null
  return date && !Number.isNaN(date.getTime()) ? date : null
}

function compareLeaveTypeNames(left, right) {
  const rank = entry => {
    const index = LEAVE_TYPE_ORDER.indexOf(String(entry.leaveType?.code || '').toUpperCase())
    return index === -1 ? LEAVE_TYPE_ORDER.length : index
  }
  const difference = rank(left) - rank(right)
  if (difference !== 0) return difference
  return String(left.leaveType?.name || left.leaveType?.code || '').localeCompare(String(right.leaveType?.name || right.leaveType?.code || ''))
}

/**
 * Pure balance projection for one fiscal year.
 *
 * - Accrual is computed from DOJ (never read from stored rows).
 * - LWP days are removed from accrual because they do not accrue.
 * - The only stored entitlement that still counts is an explicit HR override.
 * - EL carries forward from the previous year; CL/SL lapse on 31 March.
 * - A type is locked until DOJ + its unlock period; `available` is 0 while locked.
 * - `available` is null for LWP, which needs no balance.
 */
export function computeLeaveBalanceEntries({
  employeeId,
  employee,
  types = [],
  balances = [],
  requests = [],
  year,
  asOf = new Date(),
  priorAvailableByType = new Map(),
} = {}) {
  const index = buildLeaveTypeIndex(types)
  const typeId = type => String(type?._id || '')
  const resolveType = record => index.resolve(record?.leaveType) || index.resolve(record?.leaveTypeCode) || index.resolve(record?.leaveTypeName)
  const asOfDate = asOf instanceof Date ? asOf : new Date(asOf)
  const entries = new Map()
  const entryFor = type => {
    const key = typeId(type)
    if (!entries.has(key)) entries.set(key, { type, balance: null, used: 0, pending: 0 })
    return entries.get(key)
  }

  for (const type of types) {
    if (!type?.isActive) continue
    // WL/BL only appear once HR has granted days to this employee.
    if (resolveLeavePolicy(type).manualAllocation) continue
    entryFor(type)
  }
  for (const balance of balances) {
    const type = resolveType(balance)
    if (!type) continue
    const policy = resolveLeavePolicy(type)
    if (policy.manualAllocation && explicitOverrideDays(balance) === null) continue
    entryFor(type).balance = balance
  }

  const lwpTypeIds = new Set(types.filter(type => resolveLeavePolicy(type).isLeaveWithoutPay).map(typeId))
  const lwpRequests = []
  for (const request of requests) {
    if (!['pending', 'approved'].includes(String(request.status || '').toLowerCase())) continue
    const type = resolveType(request)
    const days = requestDays(request)
    if (!type || !days) continue
    const entry = entryFor(type)
    if (String(request.status).toLowerCase() === 'approved') {
      // Approved leave dated before the HR tracker import is already inside the imported "taken" days.
      const cutoff = openingImportFor(entry.balance, resolveLeavePolicy(type))?.asOf
      const start = requestStart(request)
      if (!(cutoff && start && start < cutoff)) entry.used += days
    } else entry.pending += days
    if (lwpTypeIds.has(typeId(type))) lwpRequests.push(request)
  }

  const lwpDaysByMonth = summarizeLwpDaysByMonth(lwpRequests)
  const isoDate = date => (date ? date.toISOString().slice(0, 10) : null)

  return [...entries.values()]
    .map(({ type, balance, used: requestedUsed, pending }) => {
      const policy = resolveLeavePolicy(type)
      const stored = normalizeLeaveBalance(balance || {})
      const manualAllocation = policy.manualAllocation
      // Leave taken before Talio (imported from HR's tracker) counts as used; accrual keeps running.
      const opening = openingImportFor(balance, policy)
      const openingUsed = opening ? opening.used : 0
      const used = requestedUsed + openingUsed
      // Only an explicit HR grant makes a type count. Legacy rows seeded by older
      // builds (including auto-created WL/BL) never act as an allocation.
      const override = explicitOverrideDays(balance)
      const accruedSoFar = !manualAllocation && policy.accruesMonthly
        ? accruedDays({
          annualDays: policy.annualDays,
          joiningDate: employee?.dateOfJoining,
          asOf: asOfDate,
          fiscalYear: year,
          lwpDaysByMonth,
        })
        : 0
      // Never accrue past the employee's yearly limit from HR's sheet (e.g. pro-rata EL 13.5).
      const accrued = opening?.cap !== null && opening?.cap !== undefined ? Math.min(accruedSoFar, opening.cap) : accruedSoFar
      const carriedForward = !policy.carryForward
        ? 0
        : opening?.carriedForward !== null && opening?.carriedForward !== undefined
          ? opening.carriedForward // HR's sheet already decided the carry; do not add last year's Talio balance again
          : Math.max(0, Number(stored.carriedForward) || Number(priorAvailableByType.get(typeId(type))) || 0)

      const entitlement = (override ?? accrued) + carriedForward
      const unlocksOnDate = manualAllocation || !policy.unlockMonths ? null : unlockDateFor(employee?.dateOfJoining, policy.unlockMonths)
      const isLocked = Boolean(unlocksOnDate) && asOfDate.getTime() < unlocksOnDate.getTime()
      const availableBeforeLock = Math.max(0, entitlement - used - pending)
      const available = policy.requiresBalance ? (isLocked ? 0 : availableBeforeLock) : null
      const yearlyEntitlement = manualAllocation || !policy.accruesMonthly ? null : (opening?.cap ?? policy.annualDays)

      return {
        _id: balance?._id || leaveBalanceId(employeeId, type._id, year),
        employee: employeeId,
        leaveType: pick(type, ['name', 'code', 'color']),
        year,
        fiscalYear: year,
        fiscalYearLabel: fiscalYearLabel(year),
        yearlyEntitlement,
        accrued,
        carriedForward,
        overrideDays: override,
        openingUsedDays: openingUsed,
        used,
        pending,
        available,
        isLocked,
        unlocksOn: isoDate(unlocksOnDate),
        requiresBalance: policy.requiresBalance,
        manualAllocation,
        isLeaveWithoutPay: policy.isLeaveWithoutPay,
        lapsesOnYearEnd: policy.lapsesOnYearEnd,
        unlockMonths: policy.unlockMonths,
        // Legacy aliases kept for existing screens and payroll readers.
        totalDays: entitlement,
        usedDays: used,
        remainingDays: available ?? 0,
        allocated: entitlement,
        total: entitlement,
        remaining: available ?? 0,
        balance: available ?? 0,
      }
    })
    // Manual types stay invisible until HR has granted days for this employee.
    .filter(entry => !entry.manualAllocation || Number(entry.overrideDays) > 0)
    .sort(compareLeaveTypeNames)
}

/**
 * Read-only notice-period preview used by the Apply page so the paid/LWP split
 * is visible before submitting. Mirrors the submit rejection message exactly.
 */
export async function buildNoticePreview(database, actor, { employeeId, startDate, endDate } = {}) {
  const target = await resolveBalanceEmployee(database, actor, employeeId || idOf(actor.employeeId))
  const employee = await database.get('employees', target)
  const start = parseDateOnly(startDate)
  const end = parseDateOnly(endDate)
  if (!start || !end || end < start) fail('Invalid preview dates')

  const { segments, violation } = planNoticeSegments({
    start,
    end,
    numberOfDays: countLeaveDays(start, end),
    employee,
    countDays: countLeaveDays,
  })
  const window = noticeWindow(employee)
  const isoDate = date => (date ? date.toISOString().slice(0, 10) : null)
  const sum = group => segments.filter(segment => segment.segment === group).reduce((total, segment) => total + segment.days, 0)

  return {
    employee: target,
    noticeWindow: window
      ? { resignationDate: isoDate(window.resignationDate), lastWorkingDay: isoDate(window.lastWorkingDay) }
      : null,
    segments: segments.map(segment => ({ segment: segment.segment, startDate: isoDate(segment.start), endDate: isoDate(segment.end), days: segment.days })),
    paidDays: sum('leave'),
    lwpDays: sum('lwp'),
    violation: violation
      ? { reason: violation.reason, lastWorkingDay: isoDate(violation.lastWorkingDay), message: noticeViolationMessage(violation.lastWorkingDay) }
      : null,
  }
}

/**
 * Remaining EL from the previous fiscal year, so it can carry forward.
 * One level deep: the year before that contributes only through its stored
 * carriedForward value, which keeps a balance read to two extra queries.
 */
async function resolvePriorAvailableByType({ database, employee, employeeId, types, year }) {
  const carryTypes = types.filter(type => type?.isActive && resolveLeavePolicy(type).carryForward)
  if (!carryTypes.length || !Number.isInteger(year) || year <= 1900) return new Map()

  const priorYear = year - 1
  const { start, endExclusive } = fiscalYearRange(priorYear)
  const [balances, requests, encashments] = await Promise.all([
    collectFirestorePages(database, 'leavebalances', { filters: [{ field: 'employee', operator: '==', value: employeeId }, { field: 'year', operator: '==', value: priorYear }] }),
    collectFirestorePages(database, 'leaves', { filters: [
      { field: 'employee', operator: '==', value: employeeId },
      { field: 'startDate', operator: '>=', value: start },
      { field: 'startDate', operator: '<', value: endExclusive },
    ] }),
    collectFirestorePages(database, 'leaveencashments', { filters: [{ field: 'employee', operator: '==', value: employeeId }, { field: 'year', operator: '==', value: priorYear }] }),
  ])

  const priorEntries = computeLeaveBalanceEntries({
    employeeId,
    employee,
    types,
    balances,
    requests,
    year: priorYear,
    asOf: new Date(endExclusive.getTime() - 1),
  })

  const available = new Map()
  for (const entry of priorEntries) {
    available.set(String(entry.leaveType?._id || entry._id), Math.max(0, Number(entry.totalDays) - Number(entry.usedDays) - Number(entry.pending)))
  }

  // Days encashed at the previous year end cannot also carry forward.
  return applyEncashedDays(available, encashments, String(carryTypes[0]?._id || ''))
}

/** Subtract encashed days from the prior-year carry map (EL is the carry type). */
export function applyEncashedDays(available, encashments = [], fallbackTypeId = '') {
  for (const record of encashments) {
    const days = Number(record?.days)
    if (!Number.isFinite(days) || days <= 0) continue
    const typeId = String(record?.leaveType || '') || String(fallbackTypeId || '')
    if (!typeId) continue
    available.set(typeId, Math.max(0, Number(available.get(typeId) || 0) - days))
  }
  return available
}

export async function getLeaveBalance(database, employeeId, year, { allocate = false, asOf = new Date() } = {}) {
  validateLeaveYear(year)
  validateId(employeeId)
  if (allocate) await ensureEmployeeLeaveBalances({ database, employeeId, year })
  const employee = await database.get('employees', employeeId)
  const types = await loadLeaveTypes(database)
  const { start, endExclusive } = fiscalYearRange(year)
  const balances = await collectFirestorePages(database, 'leavebalances', { filters: [{ field: 'employee', operator: '==', value: employeeId }, { field: 'year', operator: '==', value: year }] })
  const requests = await collectFirestorePages(database, 'leaves', { filters: [
    { field: 'employee', operator: '==', value: employeeId },
    { field: 'startDate', operator: '>=', value: start },
    { field: 'startDate', operator: '<', value: endExclusive },
  ] })
  const priorAvailableByType = await resolvePriorAvailableByType({ database, employee, employeeId, types, year })

  return computeLeaveBalanceEntries({ employeeId, employee, types, balances, requests, year, asOf, priorAvailableByType })
}

async function resolveBalanceEmployee(database, actor, employeeId) {
  let own = idOf(actor.employeeId)
  if (!managers.has(actor.role)) {
    if (!own) {
      const result = await database.list('employees', { filters: [{ field: 'userId', operator: '==', value: String(actor._id || actor.userId) }], limit: 2 })
      if (result.records.length === 1) own = String(result.records[0]._id)
    }
    if (employeeId && employeeId !== own) fail('Forbidden', 403)
    employeeId = own
    if (!employeeId) fail('Employee not found', 404)
  }
  return employeeId
}

export async function listLeaveBalanceSummary(database, actor, { employeeId, year, asOf }) {
  validateLeaveYear(year)
  if (employeeId) validateId(employeeId)
  const target = await resolveBalanceEmployee(database, actor, employeeId || idOf(actor.employeeId))
  return getLeaveBalance(database, target, year, { allocate: true, ...(asOf ? { asOf } : {}) })
}

export async function populateLeaveBalances(database, balances) {
  const [employees, types] = await Promise.all([
    readFirestoreReferences(database, 'employees', balances.map(item => item.employee)),
    readFirestoreReferences(database, 'leavetypes', balances.map(item => item.leaveType)),
  ])
  return balances.map(item => normalizeLeaveBalance({ ...item,
    employee: pick(employees.get(String(item.employee)), ['employeeCode', 'firstName', 'lastName', 'email', 'department']),
    leaveType: pick(types.get(String(item.leaveType)), ['name', 'color', 'code']),
  }))
}
export async function listLeaveBalances(database, actor, { employeeId, year }) {
  validateLeaveYear(year)
  if (employeeId) validateId(employeeId)
  let own = String(actor.employeeId?._id || actor.employeeId || '')
  if (!managers.has(actor.role)) {
    if (!own) {
      const result = await database.list('employees', { filters: [{ field: 'userId', operator: '==', value: String(actor._id || actor.userId) }], limit: 2 })
      if (result.records.length === 1) own = String(result.records[0]._id)
    }
    if (employeeId && employeeId !== own) fail('Forbidden', 403)
    employeeId = own
    if (!employeeId) fail('Employee not found', 404)
  }
  let balances
  if (employeeId) {
    await ensureEmployeeLeaveBalances({ database, employeeId, year })
    balances = await collectFirestorePages(database, 'leavebalances', { filters: [{ field: 'employee', operator: '==', value: employeeId }, { field: 'year', operator: '==', value: year }] })
  } else {
    const eligible = await collectFirestorePages(database, 'employees', { filters: [{ field: 'status', operator: 'in', value: [...EMPLOYED_STATUSES] }] })
    balances = []
    for (let index = 0; index < eligible.length; index += 25) {
      balances.push(...await collectFirestorePages(database, 'leavebalances', { filters: [{ field: 'employee', operator: 'in', value: eligible.slice(index, index + 25).map(employee => String(employee._id)) }, { field: 'year', operator: '==', value: year }] }))
    }
  }
  return populateLeaveBalances(database, balances)
}
/**
 * Record leave already taken this fiscal year outside Talio (HR tracker import).
 * Clears any fixed HR override so monthly accrual keeps running for this type.
 */
export async function setOpeningUsedLeave(database, actor, input) {
  if (!managers.has(actor.role)) fail('Access denied', 403)
  const { employee, leaveType } = input
  const year = Number(input.year), usedDays = Number(input.usedDays)
  validateId(employee); validateId(leaveType); validateLeaveYear(year)
  if (input.usedDays === null || input.usedDays === '' || !Number.isFinite(usedDays) || usedDays < 0) fail('Used days must be a non-negative number')
  const hasAllotted = input.allottedDays !== undefined && input.allottedDays !== null && input.allottedDays !== ''
  const allottedDays = hasAllotted ? Number(input.allottedDays) : null
  if (hasAllotted && (!Number.isFinite(allottedDays) || allottedDays < 0)) fail('Allotted days must be a non-negative number')
  const result = await database.transaction(async tx => {
    const employeeRecord = await tx.get('employees', employee)
    const typeRecord = await tx.get('leavetypes', leaveType)
    if (!employeeRecord || !typeRecord) fail('Employee or leave type not found', 404)
    const policy = resolveLeavePolicy(typeRecord)
    if (!policy.accruesMonthly) fail(`${typeRecord.name || 'This leave type'} does not accrue monthly; allocate it instead`)
    const existing = await tx.list('leavebalances', { filters: leaveBalanceFilters(employee, leaveType, year), limit: 2 })
    if (existing.records.length > 1) fail('Duplicate balances require reconciliation', 409)
    const current = existing.records[0], now = new Date()
    const round2 = value => Math.round(value * 100) / 100
    // HR's yearly limit: above the policy maximum, the extra on a carry type (EL) is last year's carry.
    const carriedForward = hasAllotted && policy.carryForward ? round2(Math.max(0, allottedDays - policy.annualDays)) : (hasAllotted ? 0 : null)
    const yearlyLimit = hasAllotted ? round2(allottedDays - (carriedForward || 0)) : null
    const accruedNow = accruedDays({ annualDays: policy.annualDays, joiningDate: employeeRecord.dateOfJoining, asOf: now, fiscalYear: year })
    const totalNow = (yearlyLimit === null ? accruedNow : Math.min(accruedNow, yearlyLimit)) + (carriedForward || 0)
    const data = {
      ...current, _id: current?._id || leaveBalanceId(employee, leaveType, year), employee, leaveType, year,
      // Stored counters mirror the computed balance at import time (Leave Allocations table reads them).
      ...buildLeaveBalanceFields({ totalDays: totalNow, usedDays, pending: normalizeLeaveBalance(current || {}).pending, carriedForward: carriedForward || 0 }),
      openingUsedDays: round2(usedDays),
      openingAllottedDays: yearlyLimit,
      openingCarriedForward: carriedForward,
      openingAsOf: now,
      openingUsedUpdatedAt: now,
      openingUsedUpdatedBy: idOf(actor._id || actor.userId) || null,
      // Imported history replaces a fixed allocation so the computed accrual applies again.
      overrideDays: null, source: 'opening',
      createdAt: current?.createdAt || now, updatedAt: now,
    }
    if (current) await tx.replace('leavebalances', data)
    else await tx.create('leavebalances', data)
    return { data, created: !current }
  })
  return { ...result, data: (await populateLeaveBalances(database, [result.data]))[0] }
}

export async function adjustLeaveBalance(database, actor, input) {
  if (!managers.has(actor.role)) fail('Access denied', 403)
  const { employee, leaveType } = input
  const year = Number(input.year), totalDays = Number(input.totalDays)
  validateId(employee); validateId(leaveType); validateLeaveYear(year)
  if (input.totalDays === null || input.totalDays === '' || !Number.isFinite(totalDays) || totalDays < 0) fail('Total days must be a non-negative number')
  const result = await database.transaction(async tx => {
    const employeeRecord = await tx.get('employees', employee)
    const typeRecord = await tx.get('leavetypes', leaveType)
    if (!employeeRecord || !typeRecord) fail('Employee or leave type not found', 404)
    const existing = await tx.list('leavebalances', { filters: leaveBalanceFilters(employee, leaveType, year), limit: 2 })
    if (existing.records.length > 1) fail('Duplicate balances require reconciliation', 409)
    const current = existing.records[0], normalized = normalizeLeaveBalance(current), now = new Date()
    const data = {
      ...current, _id: current?._id || leaveBalanceId(employee, leaveType, year), employee, leaveType, year,
      ...buildLeaveBalanceFields({ totalDays, usedDays: normalized.usedDays, pending: normalized.pending, carriedForward: normalized.carriedForward }),
      // The computed balance treats this as an explicit entitlement override.
      overrideDays: totalDays, source: 'manual',
      createdAt: current?.createdAt || now, updatedAt: now,
    }
    if (current) await tx.replace('leavebalances', data)
    else await tx.create('leavebalances', data)
    return { data, created: !current }
  })
  return { ...result, data: (await populateLeaveBalances(database, [result.data]))[0] }
}
