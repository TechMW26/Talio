jest.mock('@/lib/platform/firestoreQueries.server', () => ({
  collectFirestorePages: jest.fn(),
}))
jest.mock('@/lib/leaveBalances.server', () => ({
  getLeaveBalance: jest.fn(),
}))
jest.mock('@/lib/leaveTypes.server', () => ({
  loadLeaveTypes: jest.fn(),
}))

import {
  buildEncashmentRow,
  confirmEncashment,
  encashmentId,
  encashmentSalaryField,
  markEncashmentPaid,
  previewEncashment,
} from '@/lib/leaveEncashment.server'
import { collectFirestorePages } from '@/lib/platform/firestoreQueries.server'
import { getLeaveBalance } from '@/lib/leaveBalances.server'
import { loadLeaveTypes } from '@/lib/leaveTypes.server'

const EL = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const READY = '111111111111111111111111'
const NO_SALARY = '222222222222222222222222'
const JUNIOR = '333333333333333333333333'

const employeeReady = { _id: READY, firstName: 'Aarav', lastName: 'Ready', employeeCode: 'E1', status: 'active', dateOfJoining: '2020-04-01', salary: { grossSalary: 10000 } }
const employeeNoSalary = { _id: NO_SALARY, firstName: 'Bhavna', lastName: 'NoSalary', employeeCode: 'E2', status: 'active', dateOfJoining: '2020-04-01', salary: { basic: 9000 } }
const employeeJunior = { _id: JUNIOR, firstName: 'Chirag', lastName: 'Junior', employeeCode: 'E3', status: 'active', dateOfJoining: '2024-10-01', salary: { grossSalary: 10000 } }

function setupStore(seed = []) {
  const data = { leaveencashments: [...seed] }
  const store = {
    data,
    async get(name, id) { return (data[name] || []).find(record => String(record._id) === String(id)) || null },
    async create(name, record) { (data[name] = data[name] || []).push(record); return record },
    async replace(name, record) {
      const collection = (data[name] = data[name] || [])
      const index = collection.findIndex(item => String(item._id) === String(record._id))
      if (index >= 0) collection[index] = record
      else collection.push(record)
      return record
    },
    async transaction(run) { return run(store) },
  }

  collectFirestorePages.mockImplementation(async (_database, collection, options = {}) => {
    const filters = options.filters || []
    if (collection === 'employees') {
      const statuses = filters.find(filter => filter.field === 'status')?.value || []
      return [employeeReady, employeeNoSalary, employeeJunior].filter(employee => !statuses.length || statuses.includes(employee.status))
    }
    if (collection === 'leaveencashments') {
      const year = filters.find(filter => filter.field === 'year')?.value
      return data.leaveencashments.filter(record => year === undefined || String(record.year) === String(year))
    }
    return []
  })

  loadLeaveTypes.mockResolvedValue([{ _id: EL, code: 'EL', name: 'Earned Leave', isActive: true, maxDaysPerYear: 18 }])
  getLeaveBalance.mockImplementation(async (_database, employeeId) => {
    const days = employeeId === READY ? 10 : employeeId === NO_SALARY ? 8 : 3
    return [{ leaveType: { _id: EL, code: 'EL', name: 'Earned Leave' }, available: days, totalDays: days, usedDays: 0, pending: 0 }]
  })
  return store
}

const actor = { _id: 'user-hr', role: 'hr' }
const PAST_YEAR = 2024

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.ENCASHMENT_SALARY_FIELD
})

describe('encashment row rules', () => {
  test('10 days at 10000 monthly salary encash to 1667', () => {
    const row = buildEncashmentRow({
      employee: employeeReady,
      earnedLeave: { available: 10 },
      salaryField: 'grossSalary',
      fiscalYearEnd: new Date('2025-03-31T00:00:00Z'),
      year: PAST_YEAR,
      leaveTypeId: EL,
    })
    expect(row).toMatchObject({ eligible: true, days: 10, salary: 10000, amount: 1667, status: 'ready', issue: null, serviceYears: 4 })
  })

  test('missing salary keeps the amount null and flags the row', () => {
    const row = buildEncashmentRow({
      employee: employeeNoSalary,
      earnedLeave: { available: 8 },
      salaryField: 'grossSalary',
      fiscalYearEnd: new Date('2025-03-31T00:00:00Z'),
      year: PAST_YEAR,
      leaveTypeId: EL,
    })
    expect(row).toMatchObject({ eligible: true, days: 8, salary: null, amount: null, issue: 'salary_missing', status: 'salary_missing' })
  })

  test('employees under one year of service are ineligible and carry forward', () => {
    const row = buildEncashmentRow({
      employee: employeeJunior,
      earnedLeave: { available: 3 },
      salaryField: 'grossSalary',
      fiscalYearEnd: new Date('2025-03-31T00:00:00Z'),
      year: PAST_YEAR,
      leaveTypeId: EL,
    })
    expect(row).toMatchObject({ eligible: false, days: 0, amount: null, status: 'ineligible' })
  })

  test('salary field comes from ENCASHMENT_SALARY_FIELD', () => {
    expect(encashmentSalaryField()).toBe('grossSalary')
    process.env.ENCASHMENT_SALARY_FIELD = 'basic'
    expect(encashmentSalaryField()).toBe('basic')
    const row = buildEncashmentRow({
      employee: employeeNoSalary,
      earnedLeave: { available: 8 },
      salaryField: encashmentSalaryField(),
      fiscalYearEnd: new Date('2025-03-31T00:00:00Z'),
      year: PAST_YEAR,
      leaveTypeId: EL,
    })
    expect(row).toMatchObject({ salary: 9000, amount: 1200, status: 'ready' })
  })
})

describe('encashment run', () => {
  test('preview reports ready, salary-missing and ineligible rows', async () => {
    setupStore()
    const preview = await previewEncashment({}, actor, { year: PAST_YEAR })

    expect(preview).toMatchObject({ year: PAST_YEAR, fiscalYearLabel: 'FY 2024-25', salaryField: 'grossSalary' })
    expect(preview.payoutWindow).toEqual({ from: '2025-06-01', to: '2025-08-31' })
    expect(preview.rows.map(row => [row.employee.employeeCode, row.status])).toEqual([
      ['E1', 'ready'],
      ['E2', 'salary_missing'],
      ['E3', 'ineligible'],
    ])
    expect(preview.totals).toMatchObject({ employees: 3, eligible: 2, ready: 1, encashed: 0, missingSalary: 1, days: 10, amount: 1667 })
  })

  test('confirm is idempotent and stores the computed amount and payout window', async () => {
    const store = setupStore()

    const first = await confirmEncashment(store, actor, { year: PAST_YEAR })
    expect(first).toMatchObject({ created: 1, skippedExisting: 0, skippedSalaryMissing: 1, skippedIneligible: 1, days: 10, amount: 1667 })
    expect(store.data.leaveencashments).toHaveLength(1)

    const [record] = store.data.leaveencashments
    expect(record).toMatchObject({
      _id: encashmentId(READY, PAST_YEAR),
      employee: READY,
      leaveType: EL,
      year: PAST_YEAR,
      days: 10,
      salaryField: 'grossSalary',
      salary: 10000,
      amount: 1667,
      status: 'pending_payout',
      payoutWindow: { from: '2025-06-01', to: '2025-08-31' },
    })

    const second = await confirmEncashment(store, actor, { year: PAST_YEAR })
    expect(second).toMatchObject({ created: 0, skippedExisting: 1 })
    expect(store.data.leaveencashments).toHaveLength(1)
  })

  test('confirm refuses a fiscal year that has not closed', async () => {
    setupStore()
    await expect(confirmEncashment({}, actor, { year: 2026 })).rejects.toMatchObject({ status: 409 })
  })

  test('mark paid is idempotent', async () => {
    const store = setupStore()
    await confirmEncashment(store, actor, { year: PAST_YEAR })
    const id = store.data.leaveencashments[0]._id

    const first = await markEncashmentPaid(store, actor, { year: PAST_YEAR, ids: [id], paymentReference: 'UTR-1' })
    expect(first.updated).toBe(1)
    expect(store.data.leaveencashments[0]).toMatchObject({ status: 'paid', paymentReference: 'UTR-1' })

    const second = await markEncashmentPaid(store, actor, { year: PAST_YEAR, ids: [id], paymentReference: 'UTR-1' })
    expect(second.updated).toBe(0)
  })

  test('non-HR roles cannot preview or confirm', async () => {
    setupStore()
    await expect(previewEncashment({}, { role: 'employee' }, { year: PAST_YEAR })).rejects.toMatchObject({ status: 403 })
    await expect(confirmEncashment({}, { role: 'manager' }, { year: PAST_YEAR })).rejects.toMatchObject({ status: 403 })
  })
})
