import React from 'react'
import { render, screen, act } from '@testing-library/react'
import QuickGlanceWidget from '@/components/widgets/QuickGlanceWidget'
jest.mock('@/components/widgets/QuickGlanceWidget.module.css', () => ({}))
const props = { remainingTime: 7200, isCountingDown: true, formatCountdown: () => '02:00:00' }
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-23T08:00:00Z')) })
afterEach(() => jest.useRealTimers())

test('keeps live work hours, countdown and status in redesigned cards', () => {
  render(<QuickGlanceWidget {...props} todayAttendance={{ checkIn: '2026-09-23T06:00:00Z', status: 'in-progress' }} />)
  expect(screen.getByText('2h')).toBeInTheDocument()
  expect(screen.getByText('In Progress')).toBeInTheDocument()
  expect(screen.getByLabelText('Remaining work time')).toHaveTextContent('02:00:00')
  act(() => jest.advanceTimersByTime(60000))
  expect(screen.getByText('2h 1m')).toBeInTheDocument()
})
test('checked-out hours stay fixed, and missing punch times have placeholders', () => {
  const view = render(<QuickGlanceWidget {...props} todayAttendance={{ checkIn: '2026-09-23T06:00:00Z', checkOut: '2026-09-23T07:30:00Z', workHours: 1.5, status: 'present' }} />)
  expect(screen.getByText('1h 30m')).toBeInTheDocument()
  expect(screen.getByText('Present')).toBeInTheDocument()
  act(() => jest.advanceTimersByTime(60000))
  expect(screen.getByText('1h 30m')).toBeInTheDocument()
  view.rerender(<QuickGlanceWidget {...props} todayAttendance={{ status: 'on-leave' }} />)
  expect(screen.getByText('On Leave')).toBeInTheDocument()
  expect(screen.getAllByText('--:--')).toHaveLength(3)
})
