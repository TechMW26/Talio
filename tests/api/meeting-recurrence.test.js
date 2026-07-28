import { generateRecurringStarts } from '@/lib/meetingRecurrence'

describe('meeting recurrence', () => {
  test('creates inclusive daily occurrences', () => {
    const starts = generateRecurringStarts('2026-07-28T09:00:00', {
      pattern: 'daily',
      interval: 1,
      endDate: '2026-07-30',
    })

    expect(starts).toHaveLength(3)
  })

  test('creates selected weekly weekdays', () => {
    const starts = generateRecurringStarts('2026-07-27T09:00:00', {
      pattern: 'weekly',
      interval: 1,
      daysOfWeek: [1, 3],
      endDate: '2026-08-05',
    })

    expect(starts.map(date => date.getDay())).toEqual([1, 3, 1, 3])
  })

  test('rejects an end date before the first occurrence', () => {
    expect(generateRecurringStarts('2026-07-28T09:00:00', {
      pattern: 'daily',
      endDate: '2026-07-27',
    })).toEqual([])
  })
})
