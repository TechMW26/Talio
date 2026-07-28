import {
  buildLeaveBalanceFields,
  calculateLeaveDays,
  normalizeLeaveBalance,
  normalizeLeaveRequest,
  normalizeLeaveType,
  parseDateOnly,
} from '@/lib/leaveData'

describe('leave data compatibility', () => {
  test('normalizes legacy tenant balance fields for current leave screens', () => {
    expect(normalizeLeaveBalance({
      allocated: 12,
      used: 3,
      pending: 1,
      balance: 8,
    })).toMatchObject({
      totalDays: 12,
      usedDays: 3,
      remainingDays: 8,
      total: 12,
      used: 3,
      remaining: 8,
      available: 8,
    })
  })

  test('normalizes current balance fields for legacy dashboard consumers', () => {
    expect(normalizeLeaveBalance({
      totalDays: 10,
      usedDays: 2,
      remainingDays: 8,
    })).toMatchObject({
      allocated: 10,
      used: 2,
      balance: 8,
      total: 10,
      remaining: 8,
      available: 8,
    })
  })

  test('builds mirrored balance fields after approval', () => {
    expect(buildLeaveBalanceFields({
      totalDays: 10,
      usedDays: 4,
      remainingDays: 6,
    })).toEqual({
      totalDays: 10,
      usedDays: 4,
      remainingDays: 6,
      allocated: 10,
      used: 4,
      pending: 0,
      balance: 6,
      carriedForward: 0,
    })
  })

  test('calculates inclusive date-only leave durations', () => {
    expect(calculateLeaveDays('2026-07-27', '2026-07-29')).toBe(3)
    expect(calculateLeaveDays('2026-07-27', '2026-07-27', true)).toBe(0.5)
    expect(calculateLeaveDays('2026-07-29', '2026-07-27')).toBe(0)
    expect(parseDateOnly('2026-02-30')).toBeNull()
  })

  test('normalizes legacy request and leave type fields', () => {
    expect(normalizeLeaveRequest({ days: 2 })).toMatchObject({
      days: 2,
      numberOfDays: 2,
    })
    expect(normalizeLeaveType({ daysPerYear: 15 })).toMatchObject({
      daysPerYear: 15,
      maxDaysPerYear: 15,
    })
  })
})
