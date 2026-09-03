import {
  buildOpenAttendanceQuery,
  getAttendanceDayRange,
  previousDateKey,
  resolveScheduledCheckout,
} from '@/lib/attendanceAutoCheckout'

describe('attendance auto-checkout recovery', () => {
  test('backlog query includes every open in-progress row through the cutoff', () => {
    const cutoff = new Date('2026-09-03T18:29:59.999Z')
    expect(buildOpenAttendanceQuery({
      targetDateStart: new Date('2026-09-02T18:30:00.000Z'),
      targetDateEnd: cutoff,
      includeBacklog: true,
    })).toEqual({
      date: { $lte: cutoff },
      checkIn: { $exists: true, $ne: null },
      $or: [{ checkOut: null }, { checkOut: { $exists: false } }],
      status: 'in-progress',
    })
  })

  test('uses the configured company checkout time in its timezone', () => {
    const checkout = resolveScheduledCheckout({
      attendanceDate: new Date('2026-09-02T18:30:00.000Z'),
      checkIn: new Date('2026-09-03T03:30:00.000Z'),
      checkOutTime: '18:00',
      timezone: 'Asia/Kolkata',
    })

    expect(checkout.toISOString()).toBe('2026-09-03T12:30:00.000Z')
  })

  test('keeps the previous IST workday separate from the current day on a UTC host', () => {
    expect(previousDateKey('2026-09-03')).toBe('2026-09-02')

    const range = getAttendanceDayRange('2026-09-02', 'Asia/Kolkata')
    expect(range.start.toISOString()).toBe('2026-09-01T18:30:00.000Z')
    expect(range.end.toISOString()).toBe('2026-09-02T18:29:59.999Z')

    const currentDayStart = getAttendanceDayRange('2026-09-03', 'Asia/Kolkata').start
    expect(currentDayStart.getTime()).toBeGreaterThan(range.end.getTime())
  })

  test('never creates a checkout before a late check-in', () => {
    const checkIn = new Date('2026-09-03T15:00:00.000Z')
    const checkout = resolveScheduledCheckout({
      attendanceDate: new Date('2026-09-02T18:30:00.000Z'),
      checkIn,
      checkOutTime: '18:00',
      timezone: 'Asia/Kolkata',
    })

    expect(checkout.getTime()).toBe(checkIn.getTime() + 60_000)
  })
})
