import { randomBytes } from 'node:crypto'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getFirestoreMembershipBatchSize } from '@/lib/platform/firestoreStore.server'
import { collectFirestorePages, readFirestoreReferences } from '@/lib/platform/firestoreQueries.server'
import { isDirectReport, REPORT_FIELDS } from '@/lib/teamScope'

export const FINANCE_STORE_OPTIONS = {
  queryFields: {
    expenses: ['employee', 'status', 'createdAt'], payrolls: ['employee', 'month', 'year', 'status'],
    employees: ['employeeCode', 'department', ...REPORT_FIELDS], departments: ['head', 'heads'],
    users: ['role', 'isActive', 'employeeId'],
  },
  constraints: { payrolls: [{ fields: ['employee', 'month', 'year'] }] },
}
export const financeId = value => String(value?._id || value || '')
export const financeFilter = (field, value, operator = '==') => ({ field, value, operator })
export const financeError = (message, status = 400) => Object.assign(new Error(message), { status })
const fail = (message, status) => { throw financeError(message, status) }
const own = (record, key) => Object.prototype.hasOwnProperty.call(record, key)
const pick = (record, fields) => Object.fromEntries(fields.filter(key => record?.[key] !== undefined).map(key => [key, record[key]]))
const admin = actor => ['admin', 'super_admin'].includes(actor.role)
export const managesPayroll = actor => ['admin', 'super_admin', 'hr'].includes(actor.role)
export function getFinanceDatabase(auth) { return getFirestoreTenantDatabase(auth.tenant.databaseName, FINANCE_STORE_OPTIONS) }
export function assertFinanceId(value) { if (!/^[a-f\d]{24}$/i.test(String(value))) fail('Invalid record ID'); return String(value) }
export async function freshFinanceActor(reader, actor) {
  const current = await reader.get('users', financeId(actor._id || actor.userId))
  if (!current?.isActive) fail('Account is not active', 403)
  return current
}
const money = (value, name) => {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 1e12) fail(`Invalid ${name}`)
  return Math.round((number + Number.EPSILON) * 100) / 100
}
const date = (value, name) => { const result = new Date(value); if (!Number.isFinite(+result)) fail(`Invalid ${name}`); return result }
export function canApproveExpense(actor, employee, department) {
  if (!employee || financeId(actor.employeeId) === financeId(employee)) return false
  if (admin(actor)) return true
  const head = (actor.isDepartmentHead || actor.role === 'department_head') && (
    (actor.headOfDepartments || []).map(financeId).includes(financeId(employee.department)) ||
    [department?.head, ...(department?.heads || [])].filter(Boolean).map(financeId).includes(financeId(actor.employeeId)))
  if (head) return true
  return actor.role === 'manager' && isDirectReport(employee, actor.employeeId)
}
async function expenseScope(database, actor, approvalsOnly) {
  if (admin(actor)) return null
  const employeeId = financeId(actor.employeeId), ids = new Set(approvalsOnly || !employeeId ? [] : [employeeId])
  if (!employeeId) return [...ids]
  if (actor.isDepartmentHead || actor.role === 'department_head') {
    const departments = new Set((actor.headOfDepartments || []).map(financeId))
    for (const [field, operator] of [['head', '=='], ['heads', 'array-contains']]) {
      for (const row of await collectFirestorePages(database, 'departments', { filters: [financeFilter(field, employeeId, operator)] })) departments.add(row._id)
    }
    for (const department of departments) for (const row of await collectFirestorePages(database, 'employees', { filters: [financeFilter('department', department)] })) if (row._id !== employeeId) ids.add(row._id)
  } else if (actor.role === 'manager') {
    for (const field of REPORT_FIELDS) for (const row of await collectFirestorePages(database, 'employees', { filters: [financeFilter(field, employeeId)] })) if (row._id !== employeeId) ids.add(row._id)
  }
  return [...ids]
}
export async function populateFinance(database, collection, records) {
  const employees = await readFirestoreReferences(database, 'employees', records.flatMap(row => [row.employee, row.approvedBy]))
  const companies = collection === 'payrolls' ? await readFirestoreReferences(database, 'companies', [...employees.values()].map(row => row.company)) : new Map()
  const designations = collection === 'payrolls' ? await readFirestoreReferences(database, 'designations', [...employees.values()].map(row => row.designation)) : new Map()
  const departments = collection === 'payrolls' ? await readFirestoreReferences(database, 'departments', [...employees.values()].map(row => row.department)) : new Map()
  return records.map(row => {
    const employee = employees.get(financeId(row.employee)), approver = employees.get(financeId(row.approvedBy))
    const value = { ...row, employee: employee ? pick(employee, ['_id', 'firstName', 'lastName', 'employeeCode']) : null }
    if (collection === 'expenses') return { ...value, category: row.expenseType || row.category, expenseDate: row.date || row.expenseDate, approvedBy: approver ? pick(approver, ['_id', 'firstName', 'lastName']) : null }
    if (employee) Object.assign(value.employee, pick(employee, ['bankDetails', 'designationLevel']), {
      company: pick(companies.get(financeId(employee.company)), ['_id', 'name', 'code', 'logo', 'address']),
      designation: pick(designations.get(financeId(employee.designation)), ['_id', 'title', 'level']),
      department: pick(departments.get(financeId(employee.department)), ['_id', 'name']),
    })
    return value
  })
}
export async function listExpenses(database, actor, params) {
  actor = await freshFinanceActor(database, actor)
  const requested = params.get('employeeId'), status = params.get('status'), filters = []
  if (requested) assertFinanceId(requested)
  if (status && !['draft', 'pending', 'submitted', 'approved', 'rejected', 'reimbursed'].includes(status)) fail('Invalid expense status')
  if (status) filters.push(financeFilter('status', ['pending', 'submitted'].includes(status) ? ['pending', 'submitted'] : status, ['pending', 'submitted'].includes(status) ? 'in' : '=='))
  let scope = await expenseScope(database, actor, !requested && ['pending', 'submitted'].includes(status))
  if (requested) { if (scope && !scope.includes(requested)) fail('Expense access denied', 403); scope = [requested] }
  const records = []
  if (scope === null) records.push(...await collectFirestorePages(database, 'expenses', { filters, orderBy: [{ field: 'createdAt', direction: 'desc' }] }))
  else {
    // pending includes both imported 'pending' and current 'submitted' rows.
    // Two membership filters multiply; include the complete order/path budget.
    const batchSize = getFirestoreMembershipBatchSize(filters, [{ field: 'createdAt', direction: 'desc' }])
    for (let offset = 0; offset < scope.length; offset += batchSize) records.push(...await collectFirestorePages(database, 'expenses', { filters: [...filters, financeFilter('employee', scope.slice(offset, offset + batchSize), 'in')], orderBy: [{ field: 'createdAt', direction: 'desc' }] }))
  }
  records.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
  return populateFinance(database, 'expenses', records)
}
function expenseData(input, previous = {}) {
  const value = { currency: 'INR', receipts: [], billable: false, ...previous, ...pick(input, ['description', 'currency', 'merchant', 'paymentMethod', 'receipts', 'project', 'billable', 'remarks']) }
  value.expenseType = String(input.expenseType ?? input.category ?? previous.expenseType ?? previous.category ?? '').trim()
  if (!value.expenseType || value.expenseType.length > 100) fail('Expense type is required')
  if (!value.description?.trim() || value.description.length > 10000) fail('Description is required')
  value.amount = money(input.amount ?? previous.amount, 'amount'); if (!value.amount) fail('Amount must be greater than zero')
  value.date = date(input.date ?? input.expenseDate ?? previous.date ?? previous.expenseDate, 'expense date')
  if (!Array.isArray(value.receipts) || value.receipts.length > 30 || value.receipts.some(receipt => typeof receipt !== 'string' && (!receipt || typeof receipt.url !== 'string'))) fail('Invalid receipts')
  return value
}
export async function saveExpense(database, actor, input, id = null) {
  const recordId = id ? assertFinanceId(id) : randomBytes(12).toString('hex'), now = new Date()
  return database.transaction(async tx => {
    actor = await freshFinanceActor(tx, actor)
    const previous = id ? await tx.get('expenses', recordId) : null
    if (id && !previous) fail('Expense not found', 404)
    const employeeId = previous ? financeId(previous.employee) : financeId(input.employee || actor.employeeId)
    const employee = await tx.get('employees', assertFinanceId(employeeId))
    if (!employee) fail('Employee not found', 404)
    const isOwner = employeeId === financeId(actor.employeeId)
    if (!previous) {
      if (!isOwner && !admin(actor)) fail('You may submit only your own expenses', 403)
      const record = { ...expenseData(input), _id: recordId, employee: employeeId, expenseCode: `EXP-${recordId}`, status: 'pending', submittedDate: now, createdAt: now, updatedAt: now }
      await tx.create('expenses', record); return record
    }
    if (input.employee && financeId(input.employee) !== employeeId) fail('Expense owner cannot be changed')
    const pending = ['pending', 'submitted', 'draft', 'rejected'].includes(previous.status)
    let record
    if (input.status && ['approved', 'rejected', 'reimbursed'].includes(input.status) && input.status !== previous.status) {
      const department = employee.department ? await tx.get('departments', financeId(employee.department)) : null
      if (input.status === 'reimbursed') {
        if (!admin(actor)) fail('Only administrators may record reimbursement', 403)
        if (previous.status !== 'approved') fail('Only approved expenses may be reimbursed', 409)
      } else {
        if (!canApproveExpense(actor, employee, department)) fail('Expense approval denied', 403)
        if (!['pending', 'submitted'].includes(previous.status)) fail('Expense has already been decided', 409)
      }
      record = { ...previous, status: input.status, updatedAt: now }
      if (input.status === 'reimbursed') Object.assign(record, { reimbursementDate: now, transactionId: String(input.transactionId || '') })
      else Object.assign(record, { approvedBy: financeId(actor.employeeId) || null, approvedAt: now, approvedDate: now, rejectionReason: input.status === 'rejected' ? String(input.rejectionReason || input.remarks || '') : '' })
    } else {
      if (!isOwner || !pending) fail('Only the owner may edit an unapproved expense', 403)
      record = { ...expenseData(input, previous), updatedAt: now }
      if (input.status) {
        if (!['draft', 'pending', 'submitted'].includes(input.status)) fail('Invalid expense transition')
        record.status = input.status === 'submitted' ? 'pending' : input.status
        if (record.status === 'pending') record.submittedDate = now
      }
    }
    await tx.replace('expenses', record); return record
  })
}
export async function deleteExpense(database, actor, id) {
  return database.transaction(async tx => {
    actor = await freshFinanceActor(tx, actor)
    const previous = await tx.get('expenses', assertFinanceId(id))
    if (!previous) fail('Expense not found', 404)
    if (!admin(actor) && financeId(previous.employee) !== financeId(actor.employeeId)) fail('Expense access denied', 403)
    if (['approved', 'reimbursed'].includes(previous.status)) fail('Approved financial records cannot be deleted', 409)
    await tx.delete('expenses', id); return previous
  })
}
const PAYROLL_FIELDS = ['basic', 'allowances', 'earnings', 'deductions', 'earningsBreakdown', 'deductionsBreakdown', 'workingDays', 'presentDays', 'absentDays', 'leaveDays', 'paymentMode', 'transactionId', 'remarks', 'healthScoreImpact', 'attendanceDetails', 'overtimeGrace', 'salaryCap', 'statutory', 'paidDaysBreakdown', 'payPeriod']
function payrollData(input, previous = {}) {
  const record = { workingDays: 26, presentDays: 0, absentDays: 0, leaveDays: 0, paymentMode: 'bank-transfer', ...previous, ...pick(input, PAYROLL_FIELDS) }
  const earnings = input.earnings && typeof input.earnings === 'object' ? input.earnings : input.earningsBreakdown
  const deductions = input.deductions
  const sum = (object, name) => money(Object.values(object).reduce((total, value) => total + money(value, name), 0), name)
  const hasGrossInputs = earnings || own(input, 'basic') || own(input, 'basicSalary')
  // The payroll calculator rounds individual display components upward while
  // keeping prorated gross exact, so its explicit gross is authoritative.
  if (earnings) sum(earnings, 'earnings')
  record.grossSalary = own(input, 'grossSalary') ? money(input.grossSalary, 'grossSalary') : earnings ? sum(earnings, 'earnings') : hasGrossInputs ? money(Number(input.basic ?? input.basicSalary ?? 0) + Number(input.allowances || 0) + Number(input.hra || 0) + Number(input.overtime || 0) + Number(input.bonus || 0), 'grossSalary') : money(previous.grossSalary ?? 0, 'grossSalary')
  record.totalDeductions = deductions && typeof deductions === 'object' ? sum(deductions, 'deductions') : money(deductions ?? input.totalDeductions ?? previous.totalDeductions ?? 0, 'deductions')
  record.netSalary = Math.max(0, Math.round((record.grossSalary - record.totalDeductions) * 100) / 100)
  if (input.netSalary != null && Math.abs(money(input.netSalary, 'netSalary') - record.netSalary) > 0.02) fail('Net salary does not match earnings minus deductions')
  for (const key of ['workingDays', 'presentDays', 'absentDays', 'leaveDays']) { record[key] = money(record[key], key); if (record[key] > 31) fail(`Invalid ${key}`) }
  if (!['bank-transfer', 'cash', 'cheque'].includes(record.paymentMode)) fail('Invalid payment mode')
  if (input.paymentDate) record.paymentDate = date(input.paymentDate, 'payment date')
  return record
}
export async function listPayroll(database, actor, params) {
  actor = await freshFinanceActor(database, actor)
  let employeeId = params.get('employeeId')
  if (employeeId && !/^[a-f\d]{24}$/i.test(employeeId)) {
    const matches = await database.list('employees', { filters: [financeFilter('employeeCode', employeeId)], limit: 2 })
    if (!matches.records.length) return []
    if (matches.records.length !== 1) fail('Employee code requires reconciliation', 409)
    employeeId = matches.records[0]._id
  }
  if (!managesPayroll(actor)) {
    if (employeeId && employeeId !== financeId(actor.employeeId)) fail('Payroll access denied', 403)
    employeeId = financeId(actor.employeeId); if (!employeeId) return []
  }
  const filters = employeeId ? [financeFilter('employee', employeeId)] : []
  for (const [key, min, max] of [['month', 1, 12], ['year', 1900, 2200]]) if (params.get(key)) {
    const value = Number(params.get(key)); if (!Number.isInteger(value) || value < min || value > max) fail(`Invalid ${key}`)
    filters.push(financeFilter(key, value))
  }
  const records = await collectFirestorePages(database, 'payrolls', { filters, orderBy: [{ field: 'year', direction: 'desc' }, { field: 'month', direction: 'desc' }] })
  return populateFinance(database, 'payrolls', records)
}
export async function readPayroll(database, actor, id) {
  actor = await freshFinanceActor(database, actor)
  const record = await database.get('payrolls', assertFinanceId(id))
  if (!record) fail('Payroll not found', 404)
  if (!managesPayroll(actor) && financeId(record.employee) !== financeId(actor.employeeId)) fail('Payroll access denied', 403)
  return (await populateFinance(database, 'payrolls', [record]))[0]
}
function payrollTransition(record, status, actor) {
  if (!['draft', 'processed', 'paid', 'on-hold'].includes(status)) fail('Invalid payroll status')
  if (record.status === 'paid' && status !== 'paid') fail('Paid payroll cannot be reopened', 409)
  if (status === 'paid' && !['processed', 'paid'].includes(record.status)) fail('Process payroll before marking it paid', 409)
  const updated = { ...record, status, updatedAt: new Date() }
  if (status === 'processed' && record.status !== status) Object.assign(updated, { processedBy: financeId(actor.employeeId) || null, processedDate: new Date() })
  if (status === 'paid' && record.status !== status) { updated.paymentDate = new Date(); updated.paidAt = updated.paymentDate }
  return updated
}
export async function savePayroll(database, actor, input, id = null) {
  const recordId = id ? assertFinanceId(id) : randomBytes(12).toString('hex')
  return database.transaction(async tx => {
    actor = await freshFinanceActor(tx, actor); if (!managesPayroll(actor)) fail('Payroll administration requires HR or administrator access', 403)
    const previous = id ? await tx.get('payrolls', recordId) : null
    if (id && !previous) fail('Payroll not found', 404)
    if (previous?.status === 'paid') fail('Paid payroll is immutable', 409)
    const employeeId = assertFinanceId(financeId(previous?.employee || input.employee))
    if (!await tx.get('employees', employeeId)) fail('Employee not found', 404)
    const month = Number(previous?.month ?? input.month), year = Number(previous?.year ?? input.year)
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 1900 || year > 2200) fail('Invalid payroll period')
    for (const [key, value] of [['employee', employeeId], ['month', month], ['year', year]]) if (previous && own(input, key) && String(input[key]) !== String(value)) fail('Payroll owner and period cannot be changed')
    if (!previous) {
      const existing = await tx.list('payrolls', { filters: [financeFilter('employee', employeeId), financeFilter('month', month), financeFilter('year', year)], limit: 2 })
      if (existing.records.length) fail('Payroll already exists for this month', 409)
    }
    let record = { ...payrollData(input, previous || {}), _id: recordId, employee: employeeId, month, year, status: previous?.status || 'draft', createdAt: previous?.createdAt || new Date(), updatedAt: new Date() }
    if (input.status) record = payrollTransition(record, ['pending', 'generated'].includes(input.status) ? 'draft' : input.status, actor)
    await tx[previous ? 'replace' : 'create']('payrolls', record); return record
  })
}
export async function bulkPayroll(database, actor, ids, action) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 45) fail('Select between 1 and 45 payrolls per request')
  ids = [...new Set(ids.map(assertFinanceId))]
  const status = { process: 'processed', pay: 'paid', hold: 'on-hold' }[action]
  if (action !== 'delete' && !status) fail('Invalid payroll action')
  return database.transaction(async tx => {
    actor = await freshFinanceActor(tx, actor); if (!managesPayroll(actor)) fail('Payroll administration requires HR or administrator access', 403)
    const records = []
    for (const id of ids) {
      const record = await tx.get('payrolls', id)
      if (!record) fail('Payroll not found', 404)
      if (action === 'delete' && !['draft', 'on-hold'].includes(record.status)) fail('Only draft or held payrolls may be deleted', 409)
      records.push(action === 'delete' ? record : payrollTransition(record, status, actor))
    }
    for (const record of records) { if (action === 'delete') await tx.delete('payrolls', record._id); else await tx.replace('payrolls', record) }
    return records
  })
}
