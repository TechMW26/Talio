import { randomBytes } from 'node:crypto'
import { collectFirestorePages, readFirestoreReferences } from './platform/firestoreQueries.server'
import { LEAVE_BALANCE_STORE_OPTIONS, leaveBalanceFilters } from './leaveAllocation.server'
import { calculateLeaveDays, parseDateOnly, normalizeLeaveRequest, normalizeLeaveBalance, buildLeaveBalanceFields } from './leaveData'
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
  const [employees, types] = await Promise.all([
    readFirestoreReferences(database, 'employees', records.flatMap(record => [record.employee, record.approvedBy])),
    readFirestoreReferences(database, 'leavetypes', records.map(record => record.leaveType)),
  ])
  return records.map(record => normalizeLeaveRequest({ ...record,
    employee: pick(employees.get(idOf(record.employee)), ['firstName', 'lastName', 'employeeCode']),
    leaveType: pick(types.get(idOf(record.leaveType)), ['name', 'code']),
    approvedBy: pick(employees.get(idOf(record.approvedBy)), ['firstName', 'lastName']),
  }))
}
export async function listLeaveRequests(database, actor, params) {
  actor = await freshLeaveActor(database, actor)
  const employeeId = params.get('employeeId'), status = params.get('status'), requestType = params.get('requestType')
  if (employeeId) assertLeaveId(employeeId)
  if (status && !['pending', 'approved', 'rejected', 'cancelled'].includes(status)) fail('Invalid leave status')
  if (requestType && !['leave', 'half_day', 'work_from_home', 'early_leave'].includes(requestType)) fail('Invalid request type')
  const filters = []
  if (employeeId) filters.push({ field: 'employee', operator: '==', value: employeeId })
  if (status) filters.push({ field: 'status', operator: '==', value: status })
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
export const halfDayFilters = (employee, year, status) => [
  { field: 'employee', operator: '==', value: idOf(employee) }, { field: 'isHalfDay', operator: '==', value: true },
  { field: 'status', operator: Array.isArray(status) ? 'in' : '==', value: status },
  { field: 'startDate', operator: '>=', value: new Date(Date.UTC(year, 0, 1)) },
  { field: 'startDate', operator: '<', value: new Date(Date.UTC(year + 1, 0, 1)) },
]
function parseRequest(input) {
  const requestType = input.requestType || (input.isHalfDay ? 'half_day' : input.workFromHome ? 'work_from_home' : 'leave')
  if (!['leave', 'half_day', 'work_from_home', 'early_leave'].includes(requestType)) fail('Invalid request type')
  const startDate = parseDateOnly(input.startDate), endDate = parseDateOnly(input.endDate || input.startDate)
  const numberOfDays = calculateLeaveDays(input.startDate, input.endDate || input.startDate, requestType === 'half_day')
  if (!startDate || !endDate || endDate < startDate || numberOfDays <= 0) fail('Please select a valid start and end date')
  if (startDate.getUTCFullYear() !== endDate.getUTCFullYear()) fail('Submit separate requests for each leave year')
  if (requestType === 'half_day' && +startDate !== +endDate) fail('A half-day request must be for one date')
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 10000) fail('A valid reason is required')
  if (requestType === 'early_leave' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.earlyLeaveTime || ''))) fail('Please select a valid early leave time')
  if (input.halfDayPeriod && !['first-half', 'second-half', 'first_half', 'second_half', 'morning', 'afternoon'].includes(input.halfDayPeriod)) fail('Invalid half-day period')
  if (!input.leaveType && requestType === 'leave') fail('Leave type is required')
  if (input.leaveType) assertLeaveId(input.leaveType)
  const record = { startDate, endDate, numberOfDays, days: numberOfDays, reason: input.reason.trim(), requestType, isHalfDay: requestType === 'half_day', workFromHome: requestType === 'work_from_home', status: 'pending' }
  for (const key of ['halfDayPeriod', 'emergencyContact', 'handoverNotes']) if (input[key] !== undefined) {
    if (typeof input[key] !== 'string' || input[key].length > 10000) fail(`Invalid ${key}`)
    record[key] = input[key]
  }
  if (input.leaveType) record.leaveType = input.leaveType
  if (requestType === 'early_leave') record.earlyLeaveTime = input.earlyLeaveTime
  return record
}
async function requestBalance(tx, record) {
  const found = await tx.list('leavebalances', { filters: leaveBalanceFilters(record.employee, record.leaveType, new Date(record.startDate).getUTCFullYear()), limit: 2 })
  if (found.records.length !== 1) fail(found.records.length ? 'Duplicate balances require reconciliation' : 'No leave balance is allocated for this request', 409)
  return found.records[0]
}
export async function submitLeaveRequest(database, actor, input) {
  const fields = parseRequest(input), leaveId = randomBytes(12).toString('hex'), now = new Date()
  return database.transaction(async tx => {
    const account = await freshLeaveActor(tx, actor), employeeId = idOf(account.employeeId)
    if (!employeeId) fail('Employee information was not found')
    if (input.employee && input.employee !== employeeId) fail('You can only apply for your own account', 403)
    const employee = await tx.get('employees', employeeId)
    if (!employee || !['active', 'probation', 'on_leave'].includes(employee.status)) fail('Employee is not active', 403)
    const record = { ...fields, _id: leaveId, employee: employeeId, applicationNumber: `LV${now.getUTCFullYear()}-${leaveId}`, priority: 'medium', appliedDate: now, createdAt: now, updatedAt: now }
    let balance, guard, guardId
    if (record.isHalfDay) {
      const year = record.startDate.getUTCFullYear()
      guardId = `${employeeId}-${year}`
      guard = await tx.get('leaveguards', guardId)
      const settings = (await tx.list('companysettings', { limit: 2 })).records
      if (settings.length > 1) fail('Company settings require reconciliation', 409)
      const committed = await tx.list('leaves', { filters: halfDayFilters(employeeId, year, ['pending', 'approved']), limit: 1000, requireComplete: true })
      if (committed.records.length >= getHalfDayLimit(settings[0]?.leave?.halfDayPolicy, employee.designationLevel)) fail(`No half-day balance remains for ${year}`)
    }
    if (record.leaveType) {
      const type = await tx.get('leavetypes', record.leaveType)
      if (!type?.isActive) fail('The selected leave type is unavailable')
      if (type.applicableGender && type.applicableGender !== 'all' && type.applicableGender !== employee.gender) fail('The selected leave type is not applicable')
      balance = await requestBalance(tx, record)
      const current = normalizeLeaveBalance(balance)
      if (current.remainingDays < record.numberOfDays) fail(`Insufficient leave balance. Available: ${current.remainingDays} day(s)`)
      record.balanceReserved = true
    }
    if (guardId) {
      const next = { _id: guardId, revision: Number(guard?.revision || 0) + 1, updatedAt: now }
      if (guard) await tx.replace('leaveguards', next); else await tx.create('leaveguards', next)
    }
    if (balance) {
      const current = normalizeLeaveBalance(balance)
      await tx.replace('leavebalances', { ...balance, ...buildLeaveBalanceFields({ totalDays: current.totalDays, usedDays: current.usedDays, pending: current.pending + record.numberOfDays, carriedForward: current.carriedForward, remainingDays: current.remainingDays - record.numberOfDays }), updatedAt: now })
    }
    await tx.create('leaves', record)
    return record
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
    const days = Number(current.numberOfDays ?? current.days)
    if (!Number.isFinite(days) || days <= 0) fail('Leave duration requires reconciliation', 409)
    let balance
    const reserved = current.status === 'pending' && current.balanceReserved === true
    if (current.leaveType && (status === 'approved' || reserved || (status === 'cancelled' && current.status === 'approved'))) balance = await requestBalance(tx, current)
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
      let usedDays = normalized.usedDays, pending = normalized.pending, remainingDays = normalized.remainingDays
      if (reserved) { pending = Math.max(0, pending - days); remainingDays += days }
      if (status === 'approved') {
        if (remainingDays < days) fail('Insufficient leave balance')
        usedDays += days; remainingDays -= days
      } else if (status === 'cancelled' && current.status === 'approved') {
        if (usedDays < days) fail('Used balance requires reconciliation before cancellation', 409)
        usedDays -= days; remainingDays = Math.min(normalized.totalDays + normalized.carriedForward, remainingDays + days)
      }
      await tx.replace('leavebalances', { ...balance, ...buildLeaveBalanceFields({ totalDays: normalized.totalDays, usedDays, pending, carriedForward: normalized.carriedForward, remainingDays }), updatedAt: now })
    }
    await stageAttendance()
    if (status === 'cancelled') await tx.delete('leaves', id)
    else await tx.replace('leaves', { ...next, balanceReserved: false })
    return next
  }, { maxWrites: 400 })
}
