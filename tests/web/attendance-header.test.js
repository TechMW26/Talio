import React from 'react'
import { render, screen, act } from '@testing-library/react'
import AttendanceHeaderSummary, { workedTime } from '@/components/widgets/AttendanceHeaderSummary'

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-23T08:00:00Z')) })
afterEach(() => jest.useRealTimers())
test('header shows live work hours without a status tile', () => {
  render(<AttendanceHeaderSummary todayAttendance={{ checkIn: '2026-09-23T06:00:00Z' }} remainingTime={60} isCountingDown formatCountdown={() => '00:01:00'} />)
  expect(screen.getByText('2h 0m')).toBeInTheDocument()
  expect(screen.getByText('00:01:00')).toBeInTheDocument()
  expect(screen.queryByText('Status')).not.toBeInTheDocument()
  act(() => jest.advanceTimersByTime(60000))
  expect(screen.getByText('2h 1m')).toBeInTheDocument()
})
test('uses saved hours after checkout including zero, and handles invalid records', () => {
  const record = { checkIn: '2026-09-23T06:00:00Z', checkOut: '2026-09-23T07:00:00Z', workHours: 0 }
  expect(workedTime(record, Date.now())).toBe('0h 0m')
  expect(workedTime({ ...record, workHours: 1.999 }, Date.now())).toBe('2h 0m')
  expect(workedTime({ checkIn: 'bad' }, Date.now())).toBe('--:--')
  expect(workedTime(null, Date.now())).toBe('--:--')
})
