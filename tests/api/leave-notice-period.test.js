import { planNoticeSegments } from '@/lib/leavePolicy'
import { countLeaveDays } from '@/lib/leaveDays'

const noticeEmployee = {
  lifecycle: { offboarding: { resignationDate: '2026-11-15', lastWorkingDay: '2026-12-15' } },
}
const shape = segments => segments.map(segment => [segment.segment, segment.start.toISOString().slice(0, 10), segment.end.toISOString().slice(0, 10), segment.days])

describe('submit planning for the notice period', () => {
  test('rejects the whole request when any day is after the last working day', () => {
    const result = planNoticeSegments({ start: '2026-12-14', end: '2026-12-17', numberOfDays: 4, employee: noticeEmployee })
    expect(result.violation).toMatchObject({ reason: 'after_last_working_day' })
    expect(result.violation.lastWorkingDay.toISOString().slice(0, 10)).toBe('2026-12-15')
    expect(result.segments).toEqual([])
  })

  test('rejects a request that sits entirely after the last working day', () => {
    const result = planNoticeSegments({ start: '2026-12-16', end: '2026-12-17', numberOfDays: 2, employee: noticeEmployee })
    expect(result.violation).toMatchObject({ reason: 'after_last_working_day' })
    expect(result.segments).toEqual([])
  })

  test('splits a request that crosses the notice start into paid and LWP records', () => {
    const result = planNoticeSegments({ start: '2026-11-10', end: '2026-11-20', numberOfDays: 11, employee: noticeEmployee })
    expect(result.violation).toBeNull()
    expect(shape(result.segments)).toEqual([
      ['leave', '2026-11-10', '2026-11-14', 5],
      ['lwp', '2026-11-15', '2026-11-20', 6],
    ])
  })

  test('splits using the leave module working-day counter when provided', () => {
    const result = planNoticeSegments({ start: '2026-11-10', end: '2026-11-20', numberOfDays: 10, employee: noticeEmployee, countDays: countLeaveDays })
    expect(result.segments.map(segment => segment.days)).toEqual([5, 5])
    expect(result.segments.reduce((sum, segment) => sum + segment.days, 0)).toBe(countLeaveDays('2026-11-10', '2026-11-20'))
  })

  test('turns leave entirely inside the notice period into one LWP record', () => {
    const result = planNoticeSegments({ start: '2026-11-16', end: '2026-11-18', numberOfDays: 3, employee: noticeEmployee })
    expect(shape(result.segments)).toEqual([['lwp', '2026-11-16', '2026-11-18', 3]])
  })

  test('keeps leave before the notice period on the selected type', () => {
    const result = planNoticeSegments({ start: '2026-11-01', end: '2026-11-05', numberOfDays: 5, employee: noticeEmployee })
    expect(shape(result.segments)).toEqual([['leave', '2026-11-01', '2026-11-05', 5]])
  })

  test('treats a half day inside the notice period as half a day of LWP', () => {
    const result = planNoticeSegments({ start: '2026-11-17', end: '2026-11-17', isHalfDay: true, numberOfDays: 0.5, employee: noticeEmployee })
    expect(result.violation).toBeNull()
    expect(shape(result.segments)).toEqual([['lwp', '2026-11-17', '2026-11-17', 0.5]])
  })

  test('rejects a half day after the last working day', () => {
    const result = planNoticeSegments({ start: '2026-12-20', end: '2026-12-20', isHalfDay: true, numberOfDays: 0.5, employee: noticeEmployee })
    expect(result.violation).toMatchObject({ reason: 'after_last_working_day' })
    expect(result.segments).toEqual([])
  })

  test('still rejects dates after dateOfLeaving when no lifecycle window is recorded', () => {
    const result = planNoticeSegments({ start: '2026-12-14', end: '2026-12-17', numberOfDays: 4, employee: { dateOfLeaving: '2026-12-15' } })
    expect(result.violation).toMatchObject({ reason: 'after_last_working_day' })
  })

  test('leaves WFH and early-leave requests untouched', () => {
    const result = planNoticeSegments({ start: '2026-12-20', end: '2026-12-20', consumesBalance: false, numberOfDays: 1, employee: noticeEmployee })
    expect(result.violation).toBeNull()
    expect(shape(result.segments)).toEqual([['leave', '2026-12-20', '2026-12-20', 1]])
  })

  test('imposes no notice rule without an employment end date', () => {
    const result = planNoticeSegments({ start: '2026-12-14', end: '2026-12-17', numberOfDays: 4, employee: {} })
    expect(result.violation).toBeNull()
    expect(shape(result.segments)).toEqual([['leave', '2026-12-14', '2026-12-17', 4]])
  })
})
