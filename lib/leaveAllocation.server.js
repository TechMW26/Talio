import { buildLeaveBalanceFields, normalizeLeaveType } from '@/lib/leaveData'

export const EMPLOYED_STATUSES = Object.freeze(['active', 'probation'])

export function isLeaveEligibleEmployee(employee = {}) {
  return EMPLOYED_STATUSES.includes(String(employee.status || '').toLowerCase())
}

/**
 * Idempotently allocates every active leave type for one employee.
 * Existing balances are never overwritten, so manual HR adjustments survive.
 */
export async function ensureEmployeeLeaveBalances({ models, employeeId, year = new Date().getFullYear() }) {
  const { Employee, LeaveType, LeaveBalance } = models
  if (!Employee || !LeaveType || !LeaveBalance || !employeeId) {
    return { allocated: 0, skipped: 0, reason: 'Required models or employee ID missing' }
  }

  const employee = await Employee.findById(employeeId).select('_id status').lean()
  if (!employee || !isLeaveEligibleEmployee(employee)) {
    return { allocated: 0, skipped: 0, reason: 'Employee is not leave eligible' }
  }

  const leaveTypes = await LeaveType.find({ isActive: true }).select('_id maxDaysPerYear daysPerYear').lean()
  if (!leaveTypes.length) return { allocated: 0, skipped: 0, reason: 'No active leave types' }

  const operations = leaveTypes.map((leaveType) => {
    const normalized = normalizeLeaveType(leaveType)
    return {
      updateOne: {
        filter: { employee: employee._id, leaveType: leaveType._id, year },
        update: {
          $setOnInsert: {
            employee: employee._id,
            leaveType: leaveType._id,
            year,
            ...buildLeaveBalanceFields({ totalDays: normalized.maxDaysPerYear }),
          },
        },
        upsert: true,
      },
    }
  })

  const result = await LeaveBalance.bulkWrite(operations, { ordered: false })
  const allocated = Number(result.upsertedCount || 0)
  return { allocated, skipped: Math.max(0, leaveTypes.length - allocated) }
}
