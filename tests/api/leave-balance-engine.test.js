import { applyEncashedDays, computeLeaveBalanceEntries } from '@/lib/leaveBalances.server'

const employeeId = '111111111111111111111111'
const employee = { _id: employeeId, dateOfJoining: '2026-04-01' }
const typeIds = {
  CL: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  SL: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  EL: 'cccccccccccccccccccccccc',
  LWP: 'dddddddddddddddddddddddd',
}
const types = [
  { _id: typeIds.CL, code: 'CL', name: 'Casual Leave', isActive: true },
  { _id: typeIds.SL, code: 'SL', name: 'Sick Leave', isActive: true },
  { _id: typeIds.EL, code: 'EL', name: 'Earned Leave', isActive: true },
  { _id: typeIds.LWP, code: 'LWP', name: 'Leave Without Pay', isActive: true },
]
const byCode = entries => Object.fromEntries(entries.map(entry => [entry.leaveType.code, entry]))
const request = (code, status, days, startDate = '2026-06-10', endDate = startDate) => ({ leaveType: code, status, numberOfDays: days, startDate, endDate })

describe('computed leave balance', () => {
  test('projects accrued, used, pending and available for a full fiscal year', () => {
    const entries = byCode(computeLeaveBalanceEntries({
      employeeId,
      employee,
      types,
      balances: [],
      requests: [request('CL', 'approved', 2), request('CL', 'pending', 1), request('EL', 'approved', 3), request('CL', 'rejected', 9), request('CL', 'cancelled', 9)],
      year: 2026,
      asOf: '2027-03-31',
    }))

    expect(entries.CL).toMatchObject({ year: 2026, fiscalYear: 2026, fiscalYearLabel: 'FY 2026-27', accrued: 7, carriedForward: 0, used: 2, pending: 1, available: 4, isLocked: false, yearlyEntitlement: 7 })
    expect(entries.SL).toMatchObject({ accrued: 5, used: 0, pending: 0, available: 5, yearlyEntitlement: 5 })
    expect(entries.EL).toMatchObject({ accrued: 18, used: 3, available: 15, yearlyEntitlement: 18 })
    expect(entries.LWP).toMatchObject({ accrued: 0, carriedForward: 0, used: 0, available: null, requiresBalance: false, isLeaveWithoutPay: true, yearlyEntitlement: null })
  })

  test('leave taken before Talio (opening used) is deducted while accrual keeps running', () => {
    const oldEmployee = { _id: employeeId, dateOfJoining: '2025-08-07' }
    const opening = [{ _id: 'eeeeeeeeeeeeeeeeeeeeeeee', employee: employeeId, leaveType: typeIds.CL, year: 2026, openingUsedDays: 2.5, overrideDays: null, source: 'opening', totalDays: 0 }]
    const at = asOf => byCode(computeLeaveBalanceEntries({ employeeId, employee: oldEmployee, types, balances: opening, requests: [request('CL', 'approved', 1, '2026-12-10')], year: 2026, asOf })).CL
    expect(at('2026-11-24')).toMatchObject({ accrued: 4.08, openingUsedDays: 2.5, used: 3.5, available: 0.58 })
    expect(at('2027-01-05')).toMatchObject({ accrued: 5.25, used: 3.5, available: 1.75 })
    expect(at('2027-03-31')).toMatchObject({ accrued: 7, used: 3.5, available: 3.5 })
  })

  test('HR yearly limit caps monthly accrual (pro-rata EL 13.5 never grows to 18)', () => {
    const oldEmployee = { _id: employeeId, dateOfJoining: '2025-01-27' }
    const balances = [{ _id: 'eeeeeeeeeeeeeeeeeeeeeeee', employee: employeeId, leaveType: typeIds.EL, year: 2026, source: 'opening', overrideDays: null, openingUsedDays: 2, openingAllottedDays: 13.5, openingCarriedForward: 0 }]
    const at = asOf => byCode(computeLeaveBalanceEntries({ employeeId, employee: oldEmployee, types, balances, requests: [], year: 2026, asOf })).EL
    expect(at('2026-11-24')).toMatchObject({ accrued: 10.5, available: 8.5, yearlyEntitlement: 13.5 })
    expect(at('2027-03-31')).toMatchObject({ accrued: 13.5, carriedForward: 0, available: 11.5 })
  })

  test('imported EL carry replaces last year\'s Talio carry, so EL is not added twice', () => {
    const oldEmployee = { _id: employeeId, dateOfJoining: '2024-01-01' }
    const balances = [{ _id: 'eeeeeeeeeeeeeeeeeeeeeeee', employee: employeeId, leaveType: typeIds.EL, year: 2026, source: 'opening', overrideDays: null, openingUsedDays: 0, openingAllottedDays: 18, openingCarriedForward: 0 }]
    const priorAvailableByType = new Map([[typeIds.EL, 18]])
    const imported = byCode(computeLeaveBalanceEntries({ employeeId, employee: oldEmployee, types, balances, requests: [], year: 2026, asOf: '2027-03-31', priorAvailableByType })).EL
    expect(imported).toMatchObject({ accrued: 18, carriedForward: 0, available: 18 })
    const notImported = byCode(computeLeaveBalanceEntries({ employeeId, employee: oldEmployee, types, balances: [], requests: [], year: 2026, asOf: '2027-03-31', priorAvailableByType })).EL
    expect(notImported).toMatchObject({ carriedForward: 18 })
  })

  test('approved leave before the import date is not deducted twice; later leave is', () => {
    const oldEmployee = { _id: employeeId, dateOfJoining: '2025-08-07' }
    const balances = [{ _id: 'eeeeeeeeeeeeeeeeeeeeeeee', employee: employeeId, leaveType: typeIds.CL, year: 2026, source: 'opening', overrideDays: null, openingUsedDays: 2.5, openingAllottedDays: 7, openingCarriedForward: null, openingAsOf: new Date('2026-11-24T06:00:00Z') }]
    const requests = [request('CL', 'approved', 1, '2026-10-05'), request('CL', 'approved', 1, '2026-12-10'), request('CL', 'pending', 0.5, '2026-11-01')]
    const cl = byCode(computeLeaveBalanceEntries({ employeeId, employee: oldEmployee, types, balances, requests, year: 2026, asOf: '2027-03-31' })).CL
    expect(cl).toMatchObject({ accrued: 7, used: 3.5, pending: 0.5, available: 3 })
  })

  test('employees without an import keep normal accrual up to the policy maximum', () => {
    const newJoiner = { _id: employeeId, dateOfJoining: '2026-10-01' }
    const entries = byCode(computeLeaveBalanceEntries({ employeeId, employee: newJoiner, types, balances: [], requests: [], year: 2026, asOf: '2027-03-31' }))
    expect(entries.CL.accrued).toBeLessThanOrEqual(7)
    expect(entries.CL).toMatchObject({ accrued: 3.5, yearlyEntitlement: 7 })
    expect(entries.EL.accrued).toBeLessThanOrEqual(18)
  })

  test('opening used is ignored for manual types', () => {
    const manual = [{ _id: '222222222222222222222222', code: 'BL', name: 'Bereavement Leave', isActive: true }]
    const balances = [{ _id: '444444444444444444444444', employee: employeeId, leaveType: '222222222222222222222222', year: 2026, overrideDays: 3, source: 'manual', openingUsedDays: 2 }]
    const [entry] = computeLeaveBalanceEntries({ employeeId, employee, types: manual, balances, requests: [], year: 2026, asOf: '2026-10-23' })
    expect(entry).toMatchObject({ used: 0, available: 3 })
  })

  test('orders types CL, SL, EL, WL, BL, LWP regardless of input order', () => {
    const manualTypes = [
      { _id: '111111111111111111111111', code: 'LWP', name: 'Leave Without Pay', isActive: true },
      { _id: '222222222222222222222222', code: 'BL', name: 'Bereavement Leave', isActive: true },
      { _id: '333333333333333333333333', code: 'WL', name: 'Wedding Leave', isActive: true },
      { _id: typeIds.EL, code: 'EL', name: 'Earned Leave', isActive: true },
      { _id: typeIds.CL, code: 'CL', name: 'Casual Leave', isActive: true },
      { _id: typeIds.SL, code: 'SL', name: 'Sick Leave', isActive: true },
    ]
    const allocations = [
      { _id: '444444444444444444444444', employee: employeeId, leaveType: '222222222222222222222222', year: 2026, totalDays: 2, overrideDays: 2, source: 'manual' },
      { _id: '555555555555555555555555', employee: employeeId, leaveType: '333333333333333333333333', year: 2026, totalDays: 3, overrideDays: 3, source: 'manual' },
    ]
    const entries = computeLeaveBalanceEntries({ employeeId, employee, types: manualTypes, balances: allocations, requests: [], year: 2026, asOf: '2026-10-23' })
    expect(entries.map(entry => entry.leaveType.code)).toEqual(['CL', 'SL', 'EL', 'WL', 'BL', 'LWP'])
  })

  test('shows WL/BL only when HR has allocated days, with no accrual and no lock', () => {
    const manualTypes = [
      ...types,
      { _id: '111111111111111111111111', code: 'WL', name: 'Wedding Leave', isActive: true },
      { _id: '222222222222222222222222', code: 'BL', name: 'Bereavement Leave', isActive: true },
    ]
    const hidden = computeLeaveBalanceEntries({ employeeId, employee, types: manualTypes, balances: [], requests: [], year: 2026, asOf: '2026-10-23' })
    expect(hidden.map(entry => entry.leaveType.code)).not.toContain('WL')

    const shown = byCode(computeLeaveBalanceEntries({
      employeeId,
      employee: { ...employee, dateOfJoining: '2026-10-01' },
      types: manualTypes,
      balances: [
        { _id: '333333333333333333333333', employee: employeeId, leaveType: '111111111111111111111111', year: 2026, totalDays: 3, overrideDays: 3, source: 'manual' },
        { _id: '444444444444444444444444', employee: employeeId, leaveType: '222222222222222222222222', year: 2026, overrideDays: 0, totalDays: 0 },
      ],
      requests: [{ leaveType: 'WL', status: 'approved', numberOfDays: 1, startDate: '2026-10-05', endDate: '2026-10-05' }],
      year: 2026,
      asOf: '2026-10-23',
    }))
    expect(shown.WL).toMatchObject({ accrued: 0, carriedForward: 0, overrideDays: 3, totalDays: 3, used: 1, pending: 0, available: 2, isLocked: false, unlocksOn: null, yearlyEntitlement: null, manualAllocation: true })
    expect(shown.BL).toBeUndefined()
  })

  test('yearly entitlement is only reported for accruing types', () => {
    const entries = byCode(computeLeaveBalanceEntries({ employeeId, employee, types, balances: [], requests: [], year: 2026, asOf: '2026-10-23' }))
    expect([entries.CL.yearlyEntitlement, entries.SL.yearlyEntitlement, entries.EL.yearlyEntitlement, entries.LWP.yearlyEntitlement]).toEqual([7, 5, 18, null])
  })

  test('locks CL/SL for 3 months and EL for 6 months from DOJ', () => {
    const beforeUnlock = byCode(computeLeaveBalanceEntries({
      employeeId,
      employee: { ...employee, dateOfJoining: '2026-05-01' },
      types,
      balances: [],
      requests: [],
      year: 2026,
      asOf: '2026-07-31',
    }))
    expect(beforeUnlock.CL).toMatchObject({ isLocked: true, available: 0, unlocksOn: '2026-08-01', accrued: 1.17 })
    expect(beforeUnlock.SL).toMatchObject({ isLocked: true, available: 0, unlocksOn: '2026-08-01', accrued: 0.83 })
    expect(beforeUnlock.EL).toMatchObject({ isLocked: true, available: 0, unlocksOn: '2026-11-01', accrued: 3 })
  })

  test('respects the as-of date of the previous month boundary', () => {
    const atUnlock = byCode(computeLeaveBalanceEntries({
      employeeId,
      employee: { ...employee, dateOfJoining: '2026-05-01' },
      types,
      balances: [],
      requests: [],
      year: 2026,
      asOf: '2026-08-01',
    }))
    expect(atUnlock.CL).toMatchObject({ isLocked: false, available: 1.75, unlocksOn: '2026-08-01' })
  })

  test('LWP days reduce CL/SL/EL accrual and are reported on the LWP entry', () => {
    const entries = byCode(computeLeaveBalanceEntries({
      employeeId,
      employee,
      types,
      balances: [],
      requests: [request('LWP', 'approved', 3, '2026-06-10', '2026-06-12')],
      year: 2026,
      asOf: '2027-03-31',
    }))
    expect(entries.CL.accrued).toBe(6.94)
    expect(entries.SL.accrued).toBe(4.96)
    expect(entries.EL.accrued).toBe(17.85)
    expect(entries.LWP).toMatchObject({ used: 3, pending: 0, available: null, isLocked: false })
  })

  test('carries Earned Leave forward but lapses CL/SL', () => {
    const prior = new Map([[typeIds.EL, 4], [typeIds.CL, 6]])
    const entries = byCode(computeLeaveBalanceEntries({
      employeeId,
      employee,
      types,
      balances: [],
      requests: [request('EL', 'approved', 2)],
      year: 2026,
      asOf: '2027-03-31',
      priorAvailableByType: prior,
    }))
    expect(entries.EL).toMatchObject({ accrued: 18, carriedForward: 4, used: 2, available: 20, lapsesOnYearEnd: false })
    expect(entries.CL).toMatchObject({ accrued: 7, carriedForward: 0, lapsesOnYearEnd: true })
  })

  test('an explicit HR override replaces accrual; auto-allocation rows are ignored', () => {
    const overridden = byCode(computeLeaveBalanceEntries({
      employeeId,
      employee,
      types,
      balances: [{ _id: 'eeeeeeeeeeeeeeeeeeeeeeee', employee: employeeId, leaveType: typeIds.CL, year: 2026, totalDays: 10, overrideDays: 10, source: 'manual' }],
      requests: [request('CL', 'approved', 1)],
      year: 2026,
      asOf: '2027-03-31',
    }))
    expect(overridden.CL).toMatchObject({ overrideDays: 10, totalDays: 10, accrued: 7, used: 1, available: 9 })

    const autoAllocated = byCode(computeLeaveBalanceEntries({
      employeeId,
      employee,
      types,
      balances: [{ _id: 'ffffffffffffffffffffffff', employee: employeeId, leaveType: typeIds.CL, year: 2026, totalDays: 12 }],
      requests: [],
      year: 2026,
      asOf: '2027-03-31',
    }))
    expect(autoAllocated.CL).toMatchObject({ overrideDays: null, totalDays: 7, accrued: 7 })
  })

  test('legacy field aliases stay consistent with the computed values', () => {
    const [cl] = computeLeaveBalanceEntries({
      employeeId,
      employee,
      types: [types[0]],
      balances: [],
      requests: [request('CL', 'approved', 2), request('CL', 'pending', 1)],
      year: 2026,
      asOf: '2027-03-31',
    })
    expect(cl).toMatchObject({ totalDays: 7, allocated: 7, total: 7, usedDays: 2, remainingDays: 4, remaining: 4, balance: 4, available: 4 })
  })

  test('employees who have not joined yet show zero accrual and a locked type', () => {
    const entries = computeLeaveBalanceEntries({
      employeeId,
      employee: { ...employee, dateOfJoining: '2026-11-01' },
      types,
      balances: [],
      requests: [],
      year: 2026,
      asOf: '2026-10-23',
    })
    const cl = entries.find(entry => entry.leaveType.code === 'CL')
    expect(cl).toMatchObject({ accrued: 0, available: 0, isLocked: true, unlocksOn: '2027-02-01' })
  })

  test('resolves request types stored by code, name or id', () => {
    const entries = byCode(computeLeaveBalanceEntries({
      employeeId,
      employee,
      types,
      balances: [],
      requests: [
        { leaveType: typeIds.CL, status: 'approved', numberOfDays: 1, startDate: '2026-05-04', endDate: '2026-05-04' },
        { leaveTypeCode: 'SL', status: 'pending', numberOfDays: 0.5, startDate: '2026-05-05', endDate: '2026-05-05' },
        { leaveTypeName: 'Earned Leave', status: 'approved', numberOfDays: 2, startDate: '2026-05-06', endDate: '2026-05-07' },
      ],
      year: 2026,
      asOf: '2027-03-31',
    }))
    expect(entries.CL.used).toBe(1)
    expect(entries.SL.pending).toBe(0.5)
    expect(entries.EL.used).toBe(2)
  })

  test('uses a deterministic balance id when no row exists', () => {
    const entries = computeLeaveBalanceEntries({ employeeId, employee, types, balances: [], requests: [], year: 2026, asOf: '2027-03-31' })
    expect(entries).toHaveLength(4)
    for (const entry of entries) expect(entry._id).toMatch(/^[a-f\d]{24}$/)
    expect(new Set(entries.map(entry => entry._id)).size).toBe(4)
  })

  test('days encashed at year end do not carry forward', () => {
    const available = applyEncashedDays(new Map([['el', 12], ['cl', 4]]), [{ leaveType: 'el', days: 10 }])
    expect(available.get('el')).toBe(2)
    expect(available.get('cl')).toBe(4)
  })

  test('encashment records without a type reduce the carry type', () => {
    const available = applyEncashedDays(new Map([['el', 5], ['sl', 2]]), [{ days: 2 }], 'el')
    expect(available.get('el')).toBe(3)
    expect(available.get('sl')).toBe(2)
  })
})
