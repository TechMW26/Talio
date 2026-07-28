import { getHalfDayLimit, normalizeHalfDayPolicy } from '@/lib/halfDayPolicy'

describe('half-day hierarchy policy', () => {
  test('uses a designation-level override when configured', () => {
    const policy = normalizeHalfDayPolicy({
      defaultAnnualLimit: 10,
      limitsByLevel: [{ level: 4, maxHalfDays: 16 }],
    })

    expect(getHalfDayLimit(policy, 4)).toBe(16)
    expect(getHalfDayLimit(policy, 2)).toBe(10)
  })

  test('normalizes invalid values without allowing negative quotas', () => {
    const policy = normalizeHalfDayPolicy({
      defaultAnnualLimit: -5,
      limitsByLevel: [{ level: 1, maxHalfDays: -2 }],
    })

    expect(policy.defaultAnnualLimit).toBe(0)
    expect(getHalfDayLimit(policy, 1)).toBe(0)
  })
})
