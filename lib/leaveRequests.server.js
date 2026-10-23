import { randomBytes } from 'node:crypto'
import { collectFirestorePages, readFirestoreReferences } from './platform/firestoreQueries.server'
import { LEAVE_BALANCE_STORE_OPTIONS, leaveBalanceFilters } from './leaveAllocation.server'
import { calculateLeaveDays, parseDateOnly, normalizeLeaveRequest, normalizeLeaveBalance, buildLeaveBalanceFields } from './leaveData'
import { countLeaveDays } from './leaveDays'
import { fiscalYearFor, fiscalYearRange, noticeViolationMessage, planNoticeSegments, resolveLeavePolicy } from './leavePolicy'
import { getLeaveBalance } from './leaveBalances.server'
import { buildLeaveTypeIndex, ensureLeaveType, loadLeaveTypes, resolveLeaveTypes } from './leaveTypes.server'
import { getHalfDayLimit } from './halfDayPolicy'
import { hasReportingChain, isDirectReport } from './teamScope'
import { prepareLeaveAttendanceTransition } from './platform/firestoreLeaveAttendance.server'

export const LEAVE_STORE_OPTIONS = {
  ...LEAVE_BALANCE_STORE_OPTIONS,
  queryFields: { ...LEAVE_BALANCE_STORE_OPTIONS.queryFields, employees: ['status', 'userId'], users: ['employeeId'], attendances: ['employee', 'date'], leaves: ['employee', 'leaveType', 'status', 'isHalfDay', 'requestType', 'workFromHome', 'startDate', 'endDate', 'createdAt'] },
}
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const idOf = value => String(value?._id || value || '')
export function assertLeaveId(id) { if (!/^[a-f\d]{24}$/i.test(String(id))) fail('Invalid leave ID') }
const admin = actor => ['admin', 'super_admin'].includes(actor.role)
const pick = (record, fields) => record ? Object.fromEntries(['_id', ...fields].filter(key => record[key] !== undefined).map(key => [key, record[key]])) : null
export async function freshLeaveActor(reader, actor) {
  const current = await reader.get('users', idOf(actor._id || actor.userId))
  if (!current?.isActive) fail('Account is not active', 403)
  return current
}
export function canApproveLeave(actor, employee, department) {
  if (!employee || idOf(actor.employeeId) === idOf(employee)) return false
  if (admin(actor)) return true
  const head = (actor.isDepartmentHead || actor.role === 'department_head') && (
    (actor.headOfDepartments || []).map(idOf).includes(idOf(employee.department)) ||
    (actor.employeeId && [department?.head, ...(department?.heads || [])].filter(Boolean).map(idOf).includes(idOf(actor.employeeId)))
  )
  if (actor.role === 'hr') return Boolean(head || !hasReportingChain(employee))
  if (head) return true
  return ['manager', 'team_lead', 'department_manager'].includes(actor.role) && isDirectReport(employee, actor.employeeId)
}
export async function populateLeaves(database, records) {
  const [employees, typeResolver] = await Promise.all([
    readFirestoreReferences(database, 'employees', records.flatMap(record => [record.employee, record.approvedBy])),
    resolveLeaveTypes(database, records.flatMap(record => [record.leaveType, record.leaveTypeCode, record.leaveTypeName])),
  ])
  return records.map(record => {
    const type = typeResolver.resolve(record.leaveType)
      || typeResolver.resolve(record.leaveTypeCode)
      || typeResolver.resolve(record.leaveTypeName)
    return normalizeLeaveRequest({ ...record,
      employee: pick(employees.get(idOf(record.employee)), ['firstName', 'lastName', 'employeeCode']),
      leaveType: pick(type, ['name', 'code', 'color']),
      approvedBy: pick(employees.get(idOf(record.approvedBy)), ['firstName', 'lastName']),
    })
  })
}
export async function listLeaveRequests(database, actor, params) {
  actor = await freshLeaveActor(database, actor)
  const employeeId = params.get('employeeId'), status = params.get('status'), requestType = params.get('requestType')
  const yearParam = params.get('year')
  let year = null
  if (yearParam !== null && yearParam !== '') {
    year = Number(yearParam)
    if (!Number.isInteger(year) || year < 1900 || year > 9998) fail('Invalid leave year')
  }
  if (employeeId) assertLeaveId(employeeId)
  if (status && !['pending', 'approved', 'rejected', 'cancelled'].includes(status)) fail('Invalid leave status')
  if (requestType && !['leave', 'half_day', 'work_from_home', 'early_leave'].includes(requestType)) fail('Invalid request type')
  const filters = []
  if (employeeId) filters.push({ field: 'employee', operator: '==', value: employeeId })
  if (status) filters.push({ field: 'status', operator: '==', value: status })
  if (year) {
    const { start, endExclusive } = fiscalYearRange(year)
    filters.push({ field: 'startDate', operator: '>=', value: start })
    filters.push({ field: 'startDate', operator: '<', value: endExclusive })
  }
  // A normal employee never queries the tenant-wide request collection.
  if (!employeeId && !admin(actor) && !['hr', 'manager', 'department_head', 'team_lead', 'department_manager'].includes(actor.role) && !actor.isDepartmentHead) {
    if (status === 'pending' || !actor.employeeId) return []
    filters.push({ field: 'employee', operator: '==', value: idOf(actor.employeeId) })
  }
  let records = await collectFirestorePages(database, 'leaves', { filters, orderBy: [{ field: 'createdAt', direction: 'desc' }] })
  const employees = await readFirestoreReferences(database, 'employees', records.map(record => record.employee))
  const departments = await readFirestoreReferences(database, 'departments', [...employees.values()].map(employee => employee.department))
  records = records.filter(record => {
    const employee = employees.get(idOf(record.employee)), own = idOf(record.employee) === idOf(actor.employeeId)
    const visible = admin(actor) || ((employeeId || status !== 'pending') && own) || canApproveLeave(actor, employee, departments.get(idOf(employee?.department)))
    const type = normalizeLeaveRequest(record).requestType
    return visible && (!requestType || type === requestType)
  })
  return populateLeaves(database, records)
}
export const halfDayFilters = (employee, year, status) => {
  const { start, endExclusive } = fiscalYearRange(year)
  return [
    { field: 'employee', operator: '==', value: idOf(employee) }, { field: 'isHalfDay', operator: '==', value: true },
    { field: 'status', operator: Array.isArray(status) ? 'in' : '==', value: status },
    { field: 'startDate', operator: '>=', value: start },
    { field: 'startDate', operator: '<', value: endExclusive },
  ]
}
function parseRequest(input) {
  const requestType = input.requestType || (input.isHalfDay ? 'half_day' : input.workFromHome ? 'work_from_home' : 'leave')
  if (!['leave', 'half_day', 'work_from_home', 'early_leave'].includes(requestType)) fail('Invalid request type')
  const startDate = parseDateOnly(input.startDate), endDate = parseDateOnly(input.endDate || input.startDate)
  const numberOfDays = requestType === 'half_day'
    ? calculateLeaveDays(input.startDate, input.endDate || input.startDate, true)
    : requestType === 'leave'
      ? countLeaveDays(startDate, endDate)
      : calculateLeaveDays(input.startDate, input.endDate || input.startDate)
  if (!startDate || !endDate || endDate < startDate || numberOfDays <= 0) fail('Please select a valid start and end date')
  if (fiscalYearFor(startDate) !== fiscalYearFor(endDate)) fail('Submit separate requests for each leave year')
  if (requestType === 'half_day' && +startDate !== +endDate) fail('A half-day request must be for one date')
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 10000) fail('A valid reason is required')
  if (requestType === 'early_leave' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.earlyLeaveTime || ''))) fail('Please select a valid early leave time')
  if (input.halfDayPeriod && !['first-half', 'second-half', 'first_half', 'second_half', 'morning', 'afternoon'].includes(input.halfDayPeriod)) fail('Invalid half-day period')
  const leaveTypeInput = typeof input.leaveType === 'string' ? input.leaveType.trim() : ''
  if (!leaveTypeInput && requestType === 'leave') fail('Leave type is required')
  if (leaveTypeInput.length > 200) fail('Invalid leave type')
  const record = { startDate, endDate, numberOfDays, days: numberOfDays, reason: input.reason.trim(), requestType, isHalfDay: requestType === 'half_day', workFromHome: requestType === 'work_from_home', status: 'pending' }
  for (const key of ['halfDayPeriod', 'emergencyContact', 'handoverNotes']) if (input[key] !== undefined) {
    if (typeof input[key] !== 'string' || input[key].length > 10000) fail(`Invalid ${key}`)
    record[key] = input[key]
  }
  if (leaveTypeInput) record.leaveType = leaveTypeInput
  if (requestType === 'early_leave') record.earlyLeaveTime = input.earlyLeaveTime
  return record
}
async function findRequestBalance(tx, employeeId, leaveTypeId, year) {
  const found = await tx.list('leavebalances', { filters: leaveBalanceFilters(employeeId, leaveTypeId, year), limit: 2 })
  if (found.records.length > 1) fail('Duplicate balances require reconciliation', 409)
  return found.records[0] || null
}
function overlaps(left, right) {
  const leftStart = new Date(left.startDate).getTime(), leftEnd = new Date(left.endDate).getTime()
  const rightStart = new Date(right.startDate).getTime(), rightEnd = new Date(right.endDate).getTime()
  return leftStart <= rightEnd && leftEnd >= rightStart
}
const validDate = value => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
const formatDateKey = value => {
  const date = validDate(value)
  return date ? date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''
}

/**
 * Plan the records a submission creates. Leave that overlaps the notice period
 * is split into a paid part and an LWP part; a request that reaches past the
 * last working day is rejected outright instead of being trimmed.
 */
function planRequestSegments({ fields, employee }) {
  const { segments, violation } = planNoticeSegments({
    start: fields.startDate,
    end: fields.endDate,
    isHalfDay: fields.isHalfDay,
    consumesBalance: fields.requestType === 'leave' || fields.requestType === 'half_day',
    numberOfDays: fields.numberOfDays,
    employee,
    countDays: countLeaveDays,
  })
  if (violation) {
    fail(noticeViolationMessage(violation.lastWorkingDay), 400)
  }
  return segments
}

export async function submitLeaveRequest(database, actor, input) {
  const fields = parseRequest(input), now = new Date()
  return database.transaction(async tx => {
    const account = await freshLeaveActor(tx, actor), employeeId = idOf(account.employeeId)
    if (!employeeId) fail('Employee information was not found')
    if (input.employee && input.employee !== employeeId) fail('You can only apply for your own account', 403)
    const employee = await tx.get('employees', employeeId)
    if (!employee || !['active', 'probation', 'on_leave'].includes(employee.status)) fail('Employee is not active', 403)

    const year = fiscalYearFor(fields.startDate)

    let requestedType = null
    if (fields.leaveType) {
      requestedType = buildLeaveTypeIndex(await loadLeaveTypes(tx)).resolve(fields.leaveType)
      if (!requestedType) fail('The selected leave type was not found')
      if (!requestedType.isActive) fail('The selected leave type is unavailable')
      if (requestedType.applicableGender && requestedType.applicableGender !== 'all' && requestedType.applicableGender !== employee.gender) fail('The selected leave type is not applicable')
    }
    const requestedPolicy = requestedType ? resolveLeavePolicy(requestedType) : null

    let segments = planRequestSegments({ fields, employee })
    // Choosing an unpaid type makes every segment unpaid.
    if (requestedPolicy?.isLeaveWithoutPay) segments = segments.map(segment => ({ ...segment, segment: 'lwp' }))

    const paidDays = segments.filter(segment => segment.segment === 'leave').reduce((sum, segment) => sum + segment.days, 0)
    const lwpDays = segments.filter(segment => segment.segment === 'lwp').reduce((sum, segment) => sum + segment.days, 0)

    const committed = await collectFirestorePages(tx, 'leaves', { filters: [
      { field: 'employee', operator: '==', value: employeeId },
      { field: 'status', operator: 'in', value: ['pending', 'approved'] },
    ] })
    if (committed.some(existing => overlaps(existing, fields))) fail('You already have a pending or approved request that overlaps these dates', 409)

    let guard, guardId
    if (fields.isHalfDay) {
      guardId = `${employeeId}-${year}`
      guard = await tx.get('leaveguards', guardId)
      const settings = (await tx.list('companysettings', { limit: 2 })).records
      if (settings.length > 1) fail('Company settings require reconciliation', 409)
      const halfDays = await tx.list('leaves', { filters: halfDayFilters(employeeId, year, ['pending', 'approved']), limit: 1000, requireComplete: true })
      if (halfDays.records.length >= getHalfDayLimit(settings[0]?.leave?.halfDayPolicy, employee.designationLevel)) fail(`No half-day balance remains for ${year}`)
    }

    let balanceEntry = null
    if (requestedType && !requestedPolicy.isLeaveWithoutPay && paidDays > 0) {
      const summary = await getLeaveBalance(tx, employeeId, year, { asOf: fields.startDate })
      balanceEntry = summary.find(item => String(item.leaveType?._id) === String(requestedType._id))
      if (!balanceEntry) fail('The selected leave type has no balance configuration')
      if (balanceEntry.isLocked) fail(`${requestedType.name} is locked until ${formatDateKey(balanceEntry.unlocksOn)}.`, 400)
      const available = Number(balanceEntry.available ?? 0)
      if (paidDays > available) fail(`Insufficient ${requestedType.name} balance. Available: ${available} day(s), requested: ${paidDays} day(s).`, 400)
    }

    let reserved = false
    if (balanceEntry) {
      const balance = await findRequestBalance(tx, employeeId, requestedType._id, year)
      if (balance) {
        await tx.replace('leavebalances', { ...balance, ...buildLeaveBalanceFields({
          totalDays: balanceEntry.total,
          usedDays: balanceEntry.used,
          pending: balanceEntry.pending + paidDays,
          carriedForward: balanceEntry.carriedForward,
        }), updatedAt: now })
        reserved = true
      }
    }

    if (guardId) {
      const next = { _id: guardId, revision: Number(guard?.revision || 0) + 1, updatedAt: now }
      if (guard) await tx.replace('leaveguards', next); else await tx.create('leaveguards', next)
    }

    const lwpType = segments.some(segment => segment.segment === 'lwp') ? await ensureLeaveType(tx, 'LWP') : null
    const splitGroupId = segments.length > 1 ? randomBytes(6).toString('hex') : null
    const records = segments.map(segment => {
      const isLwp = segment.segment === 'lwp'
      const type = isLwp ? lwpType : requestedType
      const recordId = randomBytes(12).toString('hex')
      return {
        ...fields,
        _id: recordId,
        employee: employeeId,
        applicationNumber: `LV${year}-${recordId}`,
        priority: 'medium',
        appliedDate: now,
        createdAt: now,
        updatedAt: now,
        startDate: segment.start,
        endDate: segment.end,
        numberOfDays: segment.days,
        days: segment.days,
        ...(type ? { leaveType: type.code || String(type._id), leaveTypeCode: type.code || null, leaveTypeName: type.name || null } : {}),
        isLeaveWithoutPay: isLwp,
        ...(isLwp ? { unpaidReason: 'notice_period' } : {}),
        ...(splitGroupId ? { splitGroup: splitGroupId } : {}),
        ...(!isLwp && reserved ? { balanceReserved: true } : {}),
      }
    })

    for (const record of records) await tx.create('leaves', record)

    const primary = records.find(record => !record.isLeaveWithoutPay) || records[0]
    return {
      ...primary,
      split: records.length > 1
        ? {
          group: splitGroupId,
          paidDays,
          lwpDays,
          parts: records.map(record => ({
            _id: record._id,
            segment: record.isLeaveWithoutPay ? 'lwp' : 'leave',
            startDate: record.startDate,
            endDate: record.endDate,
            days: record.numberOfDays,
            leaveType: record.leaveType,
            leaveTypeName: record.leaveTypeName,
          })),
        }
        : null,
    }
  })
}
/** Approval/cancellation and balance movement are one serializable transaction.
 * Imported pending rows have no reservation marker, so their legacy balance is
 * deducted only on approval. New rows reserve once and release exactly once.
 */
export async function transitionLeaveRequest(database, actor, id, { status, reason = '' } = {}) {
  assertLeaveId(id)
  if (!['approved', 'rejected', 'cancelled'].includes(status)) fail('Invalid leave action')
  if (typeof reason !== 'string' || reason.length > 10000) fail('Invalid approval reason')
  return database.transaction(async tx => {
    const account = await freshLeaveActor(tx, actor), current = await tx.get('leaves', id)
    if (!current) fail('Leave request not found', 404)
    const employee = await tx.get('employees', idOf(current.employee))
    if (!employee) fail('Employee record requires reconciliation', 409)
    const department = employee?.department ? await tx.get('departments', idOf(employee.department)) : null
    if (status === 'cancelled') {
      if (idOf(account.employeeId) !== idOf(current.employee) && !admin(account) && account.role !== 'hr') fail('You can only cancel your own request', 403)
    } else {
      if (!canApproveLeave(account, employee, department)) fail('This request is not assigned to you for approval', 403)
      if (current.status !== 'pending') fail('Leave request has already been processed', 409)
    }
    const primaryDays = Number(current.numberOfDays)
    const days = Number.isFinite(primaryDays) && primaryDays > 0 ? primaryDays : Number(current.days)
    if (!Number.isFinite(days) || days <= 0) fail('Leave duration requires reconciliation', 409)
    let balance, computedBalance, balanceYear
    if (current.leaveType) {
      const type = buildLeaveTypeIndex(await loadLeaveTypes(tx)).resolve(current.leaveType)
      if (type) {
        balanceYear = fiscalYearFor(current.startDate)
        balance = await findRequestBalance(tx, idOf(current.employee), type._id, balanceYear)
        if (balance) {
          const summary = await getLeaveBalance(tx, idOf(current.employee), balanceYear)
          computedBalance = summary.find(item => String(item.leaveType?._id) === String(type._id))
        }
      }
    }
    const stageAttendance = await prepareLeaveAttendanceTransition(tx, employee, current, status)
    const now = new Date(), next = { ...current, status, updatedAt: now }
    if (status !== 'cancelled') {
      next.approvedBy = idOf(account.employeeId) || null
      next.approverUserId = account._id
      next.approvalDate = now; next.approvedDate = now
      if (status === 'rejected') next.rejectionReason = reason
      else next.approvalComments = reason
    }
    if (balance) {
      const normalized = normalizeLeaveBalance(balance)
      const totalDays = computedBalance?.total ?? normalized.totalDays
      const carriedForward = computedBalance?.carriedForward ?? normalized.carriedForward
      let usedDays = computedBalance?.used ?? normalized.usedDays
      let pending = computedBalance?.pending ?? normalized.pending
      if (String(current.status) === 'pending') pending = Math.max(0, pending - days)
      if (String(current.status) === 'approved') usedDays = Math.max(0, usedDays - days)
      if (status === 'approved') usedDays += days
      await tx.replace('leavebalances', { ...balance, ...buildLeaveBalanceFields({ totalDays, usedDays, pending, carriedForward }), updatedAt: now })
    }
    await stageAttendance()
    if (status === 'cancelled') await tx.delete('leaves', id)
    else await tx.replace('leaves', { ...next, balanceReserved: false })
    return next
  }, { maxWrites: 400 })
}
