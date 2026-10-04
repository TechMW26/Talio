import { createHash } from 'node:crypto'
import { buildLeaveBalanceFields, normalizeLeaveType, prorateAnnualLeave } from '@/lib/leaveData'
import { collectFirestorePages } from '@/lib/platform/firestoreQueries.server'

export const EMPLOYED_STATUSES = Object.freeze(['active', 'probation'])
export const LEAVE_BALANCE_STORE_OPTIONS = {
  queryFields: {
    employees: ['status', 'userId'], leavetypes: ['isActive'],
    leavebalances: ['employee', 'leaveType', 'year'],
  },
  constraints: { leavebalances: [{ fields: ['employee', 'leaveType', 'year'] }] },
}
export function isLeaveEligibleEmployee(employee = {}) {
  return EMPLOYED_STATUSES.includes(String(employee.status || '').toLowerCase())
}
export function leaveBalanceId(employee, leaveType, year) {
  return createHash('sha256').update(JSON.stringify([String(employee), String(leaveType), year])).digest('hex').slice(0, 24)
}
export function leaveBalanceFilters(employee, leaveType, year) {
  return [
    { field: 'employee', operator: '==', value: String(employee) },
    { field: 'leaveType', operator: '==', value: String(leaveType) },
    { field: 'year', operator: '==', value: year },
  ]
}

/** Idempotent native allocation. Read existing imported balances before creating
 * deterministic new IDs, preserving manual adjustments and in-flight approvals.
 * Each entitlement commits independently and the operation is safe to retry.
 */
export async function ensureEmployeeLeaveBalances({ database, employeeId, year = new Date().getFullYear() }) {
  if (!database || !employeeId) throw new TypeError('Tenant Firestore database and employee ID are required')
  if (!Number.isInteger(year) || year < 1900 || year > 9998) throw new TypeError('Invalid leave year')
  const employee = await database.get('employees', String(employeeId))
  if (!employee || !isLeaveEligibleEmployee(employee)) return { allocated: 0, skipped: 0, reason: 'Employee is not leave eligible' }
  const leaveTypes = await collectFirestorePages(database, 'leavetypes', { filters: [{ field: 'isActive', operator: '==', value: true }] })
  let allocated = 0
  for (const leaveType of leaveTypes) {
    const created = await database.transaction(async tx => {
      const currentEmployee = await tx.get('employees', String(employeeId))
      const currentType = await tx.get('leavetypes', String(leaveType._id))
      const existing = await tx.list('leavebalances', { filters: leaveBalanceFilters(employeeId, leaveType._id, year), limit: 2 })
      if (existing.records.length > 1) throw new Error('Duplicate imported leave balances require reconciliation')
      if (existing.records.length || !currentType?.isActive || !isLeaveEligibleEmployee(currentEmployee || {})) return false
      const now = new Date()
      await tx.create('leavebalances', {
        _id: leaveBalanceId(employeeId, leaveType._id, year), employee: String(employeeId), leaveType: String(leaveType._id), year,
        ...buildLeaveBalanceFields({ totalDays: prorateAnnualLeave(normalizeLeaveType(currentType).maxDaysPerYear, currentEmployee.dateOfJoining, year) }),
        createdAt: now, updatedAt: now,
      })
      return true
    })
    if (created) allocated++
  }
  return { allocated, skipped: leaveTypes.length - allocated }
}
