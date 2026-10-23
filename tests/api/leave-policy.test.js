import {
  DEFAULT_ENCASHMENT_SALARY_FIELD,
  HALF_DAY_DAYS,
  accruedDays,
  accruedLeave,
  addMonthsClamped,
  currentFiscalYear,
  encashmentAmount,
  encashmentPayoutWindow,
  encashmentSalaryValue,
  fiscalYearFor,
  fiscalYearLabel,
  fiscalYearRange,
  isEncashmentEligible,
  isLeaveUnlocked,
  monthlyCreditDays,
  noticeWindow,
  noticeWindowViolation,
  resolveLeavePolicy,
  roundDownHalf,
  serviceCompletedYears,
  splitByNoticePeriod,
  summarizeLwpDaysByMonth,
  unlockDateFor,
} from '@/lib/leavePolicy'
import { countLeaveDays } from '@/lib/leaveDays'

describe('fiscal year (April–March)', () => {
  test('maps dates to the fiscal year that contains them', () => {
    expect(fiscalYearFor('2026-04-01')).toBe(2026)
    expect(fiscalYearFor('2026-12-31')).toBe(2026)
    expect(fiscalYearFor('2027-03-31')).toBe(2026)
    expect(fiscalYearFor('2027-04-01')).toBe(2027)
    expect(currentFiscalYear(new Date('2026-10-23T00:00:00Z'))).toBe(2026)
  })

  test('bounds and labels the fiscal year', () => {
    const { start, end, endExclusive } = fiscalYearRange(2026)
    expect(start.toISOString().slice(0, 10)).toBe('2026-04-01')
    expect(end.toISOString().slice(0, 10)).toBe('2027-03-31')
    expect(endExclusive.toISOString().slice(0, 10)).toBe('2027-04-01')
    expect(fiscalYearLabel(2026)).toBe('FY 2026-27')
    expect(fiscalYearLabel(2029)).toBe('FY 2029-30')
    expect(() => fiscalYearRange(2026.5)).toThrow('Invalid leave year')
  })
})

describe('monthly accrual from DOJ', () => {
  const asOfYearEnd = '2027-03-31'

  test('full-year service accrues exactly CL 7, SL 5, EL 18', () => {
    const base = { joiningDate: '2026-04-01', asOf: asOfYearEnd, fiscalYear: 2026 }
    expect(accruedDays({ ...base, annualDays: 7 })).toBe(7)
    expect(accruedDays({ ...base, annualDays: 5 })).toBe(5)
    expect(accruedDays({ ...base, annualDays: 18 })).toBe(18)
  })

  test('credits each month on the 1st and rounds the running total down to 0.5', () => {
    const base = { joiningDate: '2026-04-01', fiscalYear: 2026 }
    expect(monthlyCreditDays(7)).toBeCloseTo(7 / 12, 10)
    expect(accruedDays({ ...base, annualDays: 7, asOf: '2026-04-01' })).toBe(0.5)
    expect(accruedDays({ ...base, annualDays: 5, asOf: '2026-04-01' })).toBe(0)
    expect(accruedDays({ ...base, annualDays: 18, asOf: '2026-04-01' })).toBe(1.5)
    expect(accruedDays({ ...base, annualDays: 18, asOf: '2026-04-15' })).toBe(1.5)
    expect(accruedDays({ ...base, annualDays: 5, asOf: '2026-09-30' })).toBe(2.5)
    expect(roundDownHalf(3.99)).toBe(3.5)
    expect(roundDownHalf(4)).toBe(4)
  })

  test('prorates the joining month by employed days', () => {
    // 21 Apr 2026 joins with 10 of April's 30 days, then 11 full months.
    const base = { joiningDate: '2026-04-21', asOf: asOfYearEnd, fiscalYear: 2026 }
    expect(accruedDays({ ...base, annualDays: 7 })).toBe(6.5)
    expect(accruedDays({ ...base, annualDays: 18 })).toBe(17)
  })

  test('stops at the current date instead of crediting the whole year', () => {
    const base = { joiningDate: '2026-04-01', annualDays: 18, fiscalYear: 2026 }
    expect(accruedDays({ ...base, asOf: '2026-07-31' })).toBe(6)
    expect(accruedDays({ ...base, asOf: '2026-08-01' })).toBe(7.5)
  })

  test('returns zero before joining and outside the fiscal year', () => {
    expect(accruedDays({ annualDays: 7, joiningDate: '2026-09-01', asOf: '2026-08-31', fiscalYear: 2026 })).toBe(0)
    expect(accruedDays({ annualDays: 7, joiningDate: '2026-04-01', asOf: '2026-03-31', fiscalYear: 2026 })).toBe(0)
    expect(accruedDays({ annualDays: 7, joiningDate: '2025-04-01', asOf: '2027-03-31', fiscalYear: 2026 })).toBe(7)
  })

  test('LWP days do not accrue', () => {
    // 3 LWP days in June remove 3/30 of June's credit.
    const lwpDaysByMonth = { '2026-06': 3 }
    const base = { joiningDate: '2026-04-01', asOf: asOfYearEnd, fiscalYear: 2026, lwpDaysByMonth }
    expect(accruedDays({ ...base, annualDays: 7 })).toBe(6.5)
    expect(accruedDays({ ...base, annualDays: 18 })).toBe(17.5)
    expect(accruedDays({ ...base, annualDays: 18, lwpDaysByMonth: {} })).toBe(18)
  })

  test('accruedLeave uses the resolved policy and employee DOJ', () => {
    const policy = resolveLeavePolicy({ code: 'EL' })
    expect(accruedLeave({ policy, employee: { dateOfJoining: '2026-04-01' }, asOf: asOfYearEnd, fiscalYear: 2026 })).toBe(18)
    expect(accruedLeave({ policy: resolveLeavePolicy({ code: 'LWP' }), employee: { dateOfJoining: '2026-04-01' }, fiscalYear: 2026 })).toBe(0)
  })

  test('summarizes LWP days per month, splitting multi-month requests', () => {
    const totals = summarizeLwpDaysByMonth([
      { status: 'approved', numberOfDays: 2, startDate: '2026-06-10', endDate: '2026-06-11' },
      { status: 'pending', numberOfDays: 4, startDate: '2026-06-29', endDate: '2026-07-02' },
    ])
    expect(totals['2026-06']).toBe(4)
    expect(totals['2026-07']).toBe(2)
  })
})

describe('eligibility locks', () => {
  test('CL and SL unlock after 3 months, EL after 6 months', () => {
    const joiningDate = '2026-01-15'
    expect(unlockDateFor(joiningDate, 3).toISOString().slice(0, 10)).toBe('2026-04-15')
    expect(unlockDateFor(joiningDate, 6).toISOString().slice(0, 10)).toBe('2026-07-15')
    expect(isLeaveUnlocked({ joiningDate, policy: { unlockMonths: 3 }, onDate: '2026-04-14' })).toBe(false)
    expect(isLeaveUnlocked({ joiningDate, policy: { unlockMonths: 3 }, onDate: '2026-04-15' })).toBe(true)
  })

  test('probation extension is irrelevant because only DOJ drives the unlock date', () => {
    const employee = { dateOfJoining: '2026-01-15', lifecycle: { probation: { status: 'extended', endDate: '2027-01-15' } } }
    expect(isLeaveUnlocked({ joiningDate: employee.dateOfJoining, policy: resolveLeavePolicy({ code: 'EL' }), onDate: '2026-07-15' })).toBe(true)
  })

  test('month addition clamps to the last day of a shorter month', () => {
    expect(addMonthsClamped('2025-11-30', 3).toISOString().slice(0, 10)).toBe('2026-02-28')
    expect(addMonthsClamped('2026-01-31', 1).toISOString().slice(0, 10)).toBe('2026-02-28')
  })

  test('service years are measured on completed anniversaries', () => {
    expect(serviceCompletedYears('2025-03-31', '2026-03-31')).toBe(1)
    expect(serviceCompletedYears('2025-04-01', '2026-03-31')).toBe(0)
    expect(isEncashmentEligible({ joiningDate: '2025-03-31', fiscalYearEnd: '2026-03-31' })).toBe(true)
    expect(isEncashmentEligible({ joiningDate: '2025-04-01', fiscalYearEnd: '2026-03-31' })).toBe(false)
  })
})

describe('leave type policy', () => {
  test('resolves CL, SL, EL and LWP by code or name', () => {
    expect(resolveLeavePolicy({ code: 'CL' })).toMatchObject({ annualDays: 7, unlockMonths: 3, carryForward: false, lapsesOnYearEnd: true, paid: true })
    expect(resolveLeavePolicy({ code: 'SL' })).toMatchObject({ annualDays: 5, unlockMonths: 3, carryForward: false, lapsesOnYearEnd: true })
    expect(resolveLeavePolicy({ code: 'EL' })).toMatchObject({ annualDays: 18, unlockMonths: 6, carryForward: true, lapsesOnYearEnd: false })
    expect(resolveLeavePolicy({ code: 'LWP' })).toMatchObject({ annualDays: 0, requiresBalance: false, paid: false, isLeaveWithoutPay: true })
    expect(resolveLeavePolicy({ name: 'Casual Leave' })).toMatchObject({ code: 'CL', annualDays: 7 })
    expect(resolveLeavePolicy({ name: 'Earned Leave' })).toMatchObject({ code: 'EL', annualDays: 18 })
    expect(resolveLeavePolicy({ name: 'Leave Without Pay' })).toMatchObject({ code: 'LWP' })
  })

  test('falls back to the type entitlement for non-standard types', () => {
    expect(resolveLeavePolicy({ code: 'ML', name: 'Maternity Leave', maxDaysPerYear: 182, carryForward: false }))
      .toMatchObject({ code: 'ML', annualDays: 182, accruesMonthly: true, unlockMonths: 0, carryForward: false })
  })

  test('half day is half a day', () => {
    expect(HALF_DAY_DAYS).toBe(0.5)
  })
})

describe('notice period (resignation → last working day)', () => {
  const window = { resignationDate: '2026-11-15', lastWorkingDay: '2026-12-15' }

  test('reads the notice window from the employee lifecycle', () => {
    const found = noticeWindow({ lifecycle: { offboarding: { resignationDate: '2026-11-15', lastWorkingDay: '2026-12-15' } } })
    expect(found.resignationDate.toISOString().slice(0, 10)).toBe('2026-11-15')
    expect(found.lastWorkingDay.toISOString().slice(0, 10)).toBe('2026-12-15')
    expect(noticeWindow({ lifecycle: { offboarding: { resignationDate: '2026-12-15', lastWorkingDay: '2026-11-15' } } })).toBeNull()
    expect(noticeWindow({})).toBeNull()
  })

  test('splits a request that crosses the notice start', () => {
    const result = splitByNoticePeriod({ start: '2026-11-10', end: '2026-11-20', ...window })
    expect(result.crossesNotice).toBe(true)
    expect(result.segments.map(segment => [segment.segment, segment.start.toISOString().slice(0, 10), segment.end.toISOString().slice(0, 10), segment.days])).toEqual([
      ['leave', '2026-11-10', '2026-11-14', 5],
      ['lwp', '2026-11-15', '2026-11-20', 6],
    ])
  })

  test('marks a request entirely inside the notice period as LWP', () => {
    const result = splitByNoticePeriod({ start: '2026-11-16', end: '2026-11-18', ...window })
    expect(result.crossesNotice).toBe(true)
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0]).toMatchObject({ segment: 'lwp', days: 3 })
  })

  test('keeps requests before the notice window untouched', () => {
    expect(splitByNoticePeriod({ start: '2026-11-01', end: '2026-11-05', ...window }))
      .toMatchObject({ crossesNotice: false, beyondLastWorkingDay: false, segments: [{ segment: 'leave', days: 5 }] })
  })

  test('rejects requests that extend beyond the last working day', () => {
    // Notice 15 Nov – 15 Dec: 14–17 Dec is refused, and only 14–15 Dec would be LWP.
    const violation = noticeWindowViolation({ start: '2026-12-14', end: '2026-12-17', lastWorkingDay: window.lastWorkingDay })
    expect(violation).toMatchObject({ reason: 'after_last_working_day' })
    expect(violation.lastWorkingDay.toISOString().slice(0, 10)).toBe('2026-12-15')

    const split = splitByNoticePeriod({ start: '2026-12-14', end: '2026-12-17', ...window })
    expect(split.beyondLastWorkingDay).toBe(true)
    expect(split.segments.map(segment => [segment.segment, segment.end.toISOString().slice(0, 10), segment.days])).toEqual([['lwp', '2026-12-15', 2]])

    expect(noticeWindowViolation({ start: '2026-12-14', end: '2026-12-15', lastWorkingDay: window.lastWorkingDay })).toBeNull()
    expect(noticeWindowViolation({ start: '2026-12-16', end: '2026-12-17', lastWorkingDay: window.lastWorkingDay })).toMatchObject({ reason: 'after_last_working_day' })
    expect(noticeWindowViolation({ start: '2026-12-14', end: '2026-12-15' })).toBeNull()
  })

  test('uses the caller working-day counter so Sundays are not counted', () => {
    const result = splitByNoticePeriod({ start: '2026-11-10', end: '2026-11-20', ...window, countDays: countLeaveDays })
    expect(result.segments.map(segment => segment.days)).toEqual([5, 5])
    expect(result.segments.reduce((sum, segment) => sum + segment.days, 0)).toBe(countLeaveDays('2026-11-10', '2026-11-20'))
  })
})

describe('EL encashment', () => {
  test('rounds days × salary / 30 × 0.5 (10 days at 10000 => 1667)', () => {
    expect(encashmentAmount({ days: 10, salary: 10000 })).toBe(1667)
    expect(encashmentAmount({ days: 1, salary: 30000 })).toBe(500)
    expect(encashmentAmount({ days: 0, salary: 10000 })).toBeNull()
    expect(encashmentAmount({ days: 5, salary: 0 })).toBeNull()
  })

  test('reads only the configured salary field and never falls back', () => {
    expect(DEFAULT_ENCASHMENT_SALARY_FIELD).toBe('grossSalary')
    expect(encashmentSalaryValue({ salary: { grossSalary: 10000, basic: 5000 } })).toBe(10000)
    expect(encashmentSalaryValue({ salary: { basic: 10000 } })).toBeNull()
    expect(encashmentSalaryValue({ salary: { basic: 10000 } }, 'basic')).toBe(10000)
    expect(encashmentSalaryValue({ salary: { grossSalary: 0, basic: 10000 } })).toBeNull()
    expect(encashmentSalaryValue({ salary: { grossSalary: '' } })).toBeNull()
    expect(encashmentSalaryValue({})).toBeNull()
  })

  test('missing salary produces a null amount so the preview can flag the row', () => {
    const salary = encashmentSalaryValue({ salary: { basic: 9000 } })
    expect(encashmentAmount({ days: 8, salary })).toBeNull()
  })

  test('pays June–August after the 31 March close', () => {
    const window = encashmentPayoutWindow(2026)
    expect(window.from.toISOString().slice(0, 10)).toBe('2027-06-01')
    expect(window.to.toISOString().slice(0, 10)).toBe('2027-08-31')
    expect(encashmentPayoutWindow('bad')).toBeNull()
  })
})
