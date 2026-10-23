import { createHash } from 'node:crypto'
import { EMPLOYED_STATUSES } from './leaveAllocation.server'
import { getLeaveBalance } from './leaveBalances.server'
import { loadLeaveTypes } from './leaveTypes.server'
import { collectFirestorePages } from './platform/firestoreQueries.server'
import {
  DEFAULT_ENCASHMENT_SALARY_FIELD,
  encashmentAmount,
  encashmentPayoutWindow,
  encashmentSalaryValue,
  fiscalYearLabel,
  fiscalYearRange,
  isEncashmentEligible,
  resolveLeavePolicy,
  serviceCompletedYears,
} from './leavePolicy'

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const managers = new Set(['admin', 'hr', 'super_admin', 'superadmin'])
const idOf = value => String(value?._id || value || '')
const isoDate = value => (value ? new Date(value).toISOString().slice(0, 10) : null)

function assertManager(actor) {
  if (!managers.has(String(actor?.role || ''))) fail('Only HR and Admin can run leave encashment', 403)
}

/** Salary field is configuration only — never a fallback chain. */
export function encashmentSalaryField() {
  const configured = String(process.env.ENCASHMENT_SALARY_FIELD || '').trim()
  return configured || DEFAULT_ENCASHMENT_SALARY_FIELD
}

/** Deterministic ID keeps preview/confirm idempotent per employee and fiscal year. */
export function encashmentId(employeeId, year) {
  return createHash('sha256').update(JSON.stringify(['leaveencashment', String(employeeId), Number(year)])).digest('hex').slice(0, 24)
}

export function buildEncashmentRow({ employee, earnedLeave, salaryField, fiscalYearEnd, existing, year, leaveTypeId, leaveTypeName }) {
  const eligible = isEncashmentEligible({ joiningDate: employee?.dateOfJoining, fiscalYearEnd })
  const remaining = eligible ? Math.max(0, Number(earnedLeave?.available ?? 0)) : 0
  const salary = encashmentSalaryValue(employee, salaryField)
  const amount = encashmentAmount({ days: remaining, salary })
  const issue = eligible && remaining > 0 && salary === null ? 'salary_missing' : null

  const status = existing
    ? String(existing.status || 'pending_payout')
    : !eligible
      ? 'ineligible'
      : remaining <= 0
        ? 'nothing_to_encash'
        : issue
          ? 'salary_missing'
          : 'ready'

  return {
    encashmentId: encashmentId(employee._id, year),
    employee: {
      _id: idOf(employee._id),
      employeeCode: employee.employeeCode || '',
      firstName: employee.firstName || '',
      lastName: employee.lastName || '',
      department: employee.department || null,
      dateOfJoining: isoDate(employee.dateOfJoining),
    },
    leaveTypeId: String(leaveTypeId || ''),
    leaveTypeName: leaveTypeName || 'Earned Leave',
    serviceYears: serviceCompletedYears(employee.dateOfJoining, fiscalYearEnd),
    eligible,
    days: remaining,
    salaryField,
    salary,
    amount,
    issue,
    status,
    alreadyEncashed: Boolean(existing),
    encashedAt: existing?.createdAt ? isoDate(existing.createdAt) : null,
    paidAt: existing?.paidAt ? isoDate(existing.paidAt) : null,
    paymentReference: existing?.paymentReference || null,
  }
}

/**
 * Read-only preview for the HR encashment run. Recomputed server-side for every
 * call (including confirm) so client numbers are never trusted.
 */
export async function previewEncashment(database, actor, { year, employeeId } = {}) {
  assertManager(actor)
  const fiscalYear = Number(year)
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 9998) fail('Invalid leave year')

  const { end } = fiscalYearRange(fiscalYear)
  const fiscalYearEnd = end
  const salaryField = encashmentSalaryField()
  const payoutWindow = encashmentPayoutWindow(fiscalYear)

  const employees = (employeeId
    ? [await database.get('employees', String(employeeId))]
    : await collect(database, 'employees', [{ field: 'status', operator: 'in', value: [...EMPLOYED_STATUSES] }]))
    .filter(employee => {
      if (!employee) return false
      const joined = employee.dateOfJoining ? new Date(employee.dateOfJoining) : null
      // Employees who joined after the fiscal year closed are not part of that run.
      return !joined || Number.isNaN(joined.getTime()) || joined.getTime() <= fiscalYearEnd.getTime()
    })
  const types = await loadLeaveTypes(database)
  const earnedLeaveType = types.find(type => resolveLeavePolicy(type).code === 'EL')
  if (!earnedLeaveType) fail('Earned Leave is not configured for this tenant', 409)

  const encashments = await collect(database, 'leaveencashments', [{ field: 'year', operator: '==', value: fiscalYear }])
  const existingByEmployee = new Map(encashments.map(record => [String(record.employee), record]))

  const rows = []
  for (const employee of employees) {
    if (!employee?._id) continue
    // Ineligible employees cannot encash, so skip the balance read entirely.
    const eligible = isEncashmentEligible({ joiningDate: employee.dateOfJoining, fiscalYearEnd })
    const balances = eligible ? await getLeaveBalance(database, idOf(employee._id), fiscalYear, { asOf: fiscalYearEnd }) : []
    const earnedLeave = balances.find(entry => String(entry.leaveType?._id) === String(earnedLeaveType._id))
    rows.push(buildEncashmentRow({
      employee,
      earnedLeave,
      salaryField,
      fiscalYearEnd,
      existing: existingByEmployee.get(String(employee._id)),
      year: fiscalYear,
      leaveTypeId: earnedLeaveType._id,
      leaveTypeName: earnedLeaveType.name,
    }))
  }

  rows.sort((left, right) => `${left.employee.firstName} ${left.employee.lastName}`.localeCompare(`${right.employee.firstName} ${right.employee.lastName}`) || left.employee._id.localeCompare(right.employee._id))
  const ready = rows.filter(row => row.status === 'ready')

  return {
    year: fiscalYear,
    fiscalYearLabel: fiscalYearLabel(fiscalYear),
    fiscalYearEnd: isoDate(fiscalYearEnd),
    salaryField,
    payoutWindow: payoutWindow ? { from: isoDate(payoutWindow.from), to: isoDate(payoutWindow.to) } : null,
    rows,
    totals: {
      employees: rows.length,
      eligible: rows.filter(row => row.eligible).length,
      ready: ready.length,
      encashed: rows.filter(row => row.alreadyEncashed).length,
      missingSalary: rows.filter(row => row.issue === 'salary_missing').length,
      days: ready.reduce((sum, row) => sum + row.days, 0),
      amount: ready.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    },
  }
}

async function collect(database, collection, filters) {
  return collectFirestorePages(database, collection, { filters })
}

/**
 * Confirm the run. Every record uses a deterministic ID and is created inside a
 * transaction that re-checks existence, so re-running never double-credits.
 */
export async function confirmEncashment(database, actor, { year, employeeIds } = {}) {
  assertManager(actor)
  const fiscalYear = Number(year)
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 9998) fail('Invalid leave year')
  const { end } = fiscalYearRange(fiscalYear)
  if (new Date().getTime() < end.getTime()) fail('Encashment can only be confirmed after the fiscal year ends on 31 March', 409)

  const preview = await previewEncashment(database, actor, { year: fiscalYear })
  const selected = Array.isArray(employeeIds) && employeeIds.length
    ? new Set(employeeIds.map(String))
    : null

  const now = new Date()
  const result = { year: preview.year, created: 0, skippedExisting: 0, skippedSalaryMissing: 0, skippedIneligible: 0, skippedNothing: 0, days: 0, amount: 0 }

  for (const row of preview.rows) {
    if (selected && !selected.has(String(row.employee._id))) continue
    if (row.alreadyEncashed) { result.skippedExisting += 1; continue }
    if (!row.eligible) { result.skippedIneligible += 1; continue }
    if (row.issue === 'salary_missing') { result.skippedSalaryMissing += 1; continue }
    if (!(row.days > 0) || row.amount === null) { result.skippedNothing += 1; continue }

    let created
    try {
      created = await database.transaction(async tx => {
        const existing = await tx.get('leaveencashments', row.encashmentId)
        if (existing) return false
        await tx.create('leaveencashments', {
          _id: row.encashmentId,
          employee: String(row.employee._id),
          leaveType: row.leaveTypeId,
          year: preview.year,
          fiscalYearLabel: preview.fiscalYearLabel,
          fiscalYearEnd: preview.fiscalYearEnd,
          days: row.days,
          salaryField: row.salaryField,
          salary: row.salary,
          amount: row.amount,
          status: 'pending_payout',
          payoutWindow: preview.payoutWindow,
          runAt: now,
          createdBy: String(actor?._id || actor?.userId || ''),
          createdAt: now,
          updatedAt: now,
        })
        return true
      })
    } catch (error) {
      // A concurrent run for the same employee/year is a safe skip, not a failure.
      if (error?.code === 'ALREADY_EXISTS') { result.skippedExisting += 1; continue }
      throw error
    }

    if (created) {
      result.created += 1
      result.days += row.days
      result.amount += row.amount
    } else {
      result.skippedExisting += 1
    }
  }

  return result
}

/** Mark already-created encashments as paid (payout window June–August). */
export async function markEncashmentPaid(database, actor, { year, ids = [], paymentReference = '' } = {}) {
  assertManager(actor)
  const fiscalYear = Number(year)
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 9998) fail('Invalid leave year')
  if (typeof paymentReference !== 'string' || paymentReference.length > 200) fail('Invalid payment reference')

  const wanted = new Set((Array.isArray(ids) ? ids : []).map(String))
  const records = await collect(database, 'leaveencashments', [{ field: 'year', operator: '==', value: fiscalYear }])
  const targets = records.filter(record => record.status === 'pending_payout' && (!wanted.size || wanted.has(String(record._id))))
  const now = new Date()
  for (const record of targets) {
    await database.transaction(async tx => {
      const current = await tx.get('leaveencashments', String(record._id))
      if (!current || current.status === 'paid') return
      await tx.replace('leaveencashments', { ...current, status: 'paid', paidAt: now, paymentReference: paymentReference.trim(), updatedAt: now })
    })
  }
  return { year: fiscalYear, updated: targets.length }
}
