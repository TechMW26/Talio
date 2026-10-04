import { buildLeaveBalanceFields, normalizeLeaveBalance } from './leaveData'
import { EMPLOYED_STATUSES, ensureEmployeeLeaveBalances, leaveBalanceFilters, leaveBalanceId } from './leaveAllocation.server'
import { collectFirestorePages, readFirestoreReferences } from './platform/firestoreQueries.server'

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const managers = new Set(['admin', 'super_admin', 'hr'])
const pick = (record, fields) => record ? Object.fromEntries(['_id', ...fields].filter(key => record[key] !== undefined).map(key => [key, record[key]])) : null
export function validateLeaveYear(year) {
  if (!Number.isInteger(year) || year < 1900 || year > 9998) fail('Invalid leave year')
}
function validateId(id) { if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) fail('Invalid employee or leave type ID') }

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
      createdAt: current?.createdAt || now, updatedAt: now,
    }
    if (current) await tx.replace('leavebalances', data)
    else await tx.create('leavebalances', data)
    return { data, created: !current }
  })
  return { ...result, data: (await populateLeaveBalances(database, [result.data]))[0] }
}
