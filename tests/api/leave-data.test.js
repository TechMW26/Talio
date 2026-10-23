import {
  buildLeaveBalanceFields,
  calculateLeaveDays,
  normalizeLeaveBalance,
  normalizeLeaveRequest,
  normalizeLeaveType,
  parseDateOnly,
} from '@/lib/leaveData'
import { countLeaveDays, formatLeaveDays } from '@/lib/leaveDays'

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

  test('derives remaining from the balance formula instead of stale stored totals', () => {
    expect(normalizeLeaveBalance({
      totalDays: 10,
      usedDays: 0,
      pending: 2,
      remainingDays: 10,
    })).toMatchObject({
      totalDays: 10,
      usedDays: 0,
      pending: 2,
      remainingDays: 8,
      available: 8,
    })
  })

  test('does not count carried-forward days twice for server projections', () => {
    // getLeaveBalance folds the carry into totalDays, so the widget must not add it again.
    expect(normalizeLeaveBalance({
      accrued: 18,
      totalDays: 23,
      carriedForward: 5,
      usedDays: 2,
      pending: 1,
      available: 20,
    })).toMatchObject({ totalDays: 23, available: 20, remainingDays: 20 })
  })

  test('keeps locked types unusable and unpaid types unlimited when normalizing', () => {
    expect(normalizeLeaveBalance({
      totalDays: 5,
      usedDays: 0,
      pending: 0,
      isLocked: true,
    })).toMatchObject({ totalDays: 5, available: 0, remainingDays: 0 })

    expect(normalizeLeaveBalance({
      totalDays: 0,
      requiresBalance: false,
    })).toMatchObject({ available: null, remainingDays: 0 })
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

  test('counts full working days and skips Sundays and holidays', () => {
    expect(countLeaveDays('2026-07-27', '2026-07-31')).toBe(5)
    expect(countLeaveDays('2026-07-31', '2026-08-02')).toBe(2)
    expect(countLeaveDays('2026-07-27', '2026-07-31', ['2026-07-29'])).toBe(4)
    expect(countLeaveDays('2026-08-02', '2026-08-02')).toBe(0)
  })

  test('pluralizes leave counts', () => {
    expect(formatLeaveDays(1)).toBe('1 day')
    expect(formatLeaveDays(0)).toBe('0 days')
    expect(formatLeaveDays(2)).toBe('2 days')
    expect(formatLeaveDays(0.5)).toBe('0.5 days')
    expect(formatLeaveDays('3')).toBe('3 days')
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
