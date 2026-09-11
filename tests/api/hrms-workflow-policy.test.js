import { HOLIDAY_DAY_PORTIONS, HOLIDAY_TYPES, normalizeHolidayType, sanitizeHolidayPayload } from '@/lib/holidayPolicy'
import { EMPLOYED_STATUSES, isLeaveEligibleEmployee } from '@/lib/leaveAllocation.server'
import { isScreenCaptureProtectedRole } from '@/lib/productivityPrivacy'

describe('HRMS workflow policies', () => {
  test('protects both Admin and HR screens from productivity capture', () => {
    expect(isScreenCaptureProtectedRole('ADMIN')).toBe(true)
    expect(isScreenCaptureProtectedRole('hr')).toBe(true)
    expect(isScreenCaptureProtectedRole('employee')).toBe(false)
  })

  test('allocates leave only to currently employed status values', () => {
    expect(EMPLOYED_STATUSES).toEqual(['active', 'probation'])
    expect(isLeaveEligibleEmployee({ status: 'active' })).toBe(true)
    expect(isLeaveEligibleEmployee({ status: 'probation' })).toBe(true)
    expect(isLeaveEligibleEmployee({ status: 'resigned' })).toBe(false)
    expect(isLeaveEligibleEmployee({ status: 'terminated' })).toBe(false)
  })

  test('restricts holidays to public and company types', () => {
    expect(HOLIDAY_TYPES).toEqual(['public', 'company'])
    expect(normalizeHolidayType('Public Holiday')).toBe('public')
    expect(normalizeHolidayType('company_specific')).toBe('company')
    expect(normalizeHolidayType('google')).toBeNull()

    const payload = sanitizeHolidayPayload({ name: 'Foundation Day', date: '2026-09-10', type: 'Company Holiday' })
    expect(payload).toMatchObject({ name: 'Foundation Day', type: 'company', category: 'company_specific', isOptional: false })
  })

  test('supports management-approved full and half-day holidays', () => {
    expect(HOLIDAY_DAY_PORTIONS).toEqual(['full_day', 'first_half', 'second_half'])
    expect(sanitizeHolidayPayload({ name: 'Foundation Morning', date: '2026-09-10', type: 'company', dayPortion: 'first_half' }))
      .toMatchObject({ dayPortion: 'first_half' })
    expect(() => sanitizeHolidayPayload({ name: 'Invalid', date: '2026-09-10', type: 'company', dayPortion: 'quarter_day' }))
      .toThrow('Holiday duration')
  })
})
