import { render, screen, fireEvent, act, within } from '@testing-library/react'
import CheckInOutWidget from '@/components/widgets/CheckInOutWidget'
import fs from 'node:fs'

jest.mock('@/components/ui/fernly', () => ({
  Card: ({ children }) => <div>{children}</div>, CardBody: ({ children }) => <div>{children}</div>,
  Avatar: () => <span />, Chip: ({ children }) => <span>{children}</span>, Heading2: ({ children }) => <h2>{children}</h2>,
  Button: ({ children, onPress, isDisabled }) => <button disabled={isDisabled} onClick={onPress}>{children}</button>,
}))
jest.mock('@/components/widgets/DayCompass', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/attendance/LocationAccessStatus', () => ({ __esModule: true, default: () => null }))
const base = { user: { firstName: 'Asha', lastName: 'Singh' }, onClockIn: jest.fn(), onClockOut: jest.fn() }
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-07T08:00:00Z')); jest.clearAllMocks() })
afterEach(() => jest.useRealTimers())

test('adds two useful cards with honest pre-check-in and unconfigured schedule states', () => {
  render(<CheckInOutWidget {...base} />)
  expect(screen.getByRole('region', { name: 'Time worked card' })).toHaveTextContent('Starts when you check in.')
  expect(screen.getByRole('region', { name: 'Work schedule card' })).toHaveTextContent('Not configured')
  expect(screen.getByRole('link', { name: /View attendance/ })).toHaveAttribute('href', '/dashboard/attendance')
  fireEvent.click(screen.getByRole('button', { name: 'Check In' }))
  expect(base.onClockIn).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Check Out' })).toBeDisabled()
})

test('live elapsed time updates by minute and stops at check-out', () => {
  const view = render(<CheckInOutWidget {...base} todayAttendance={{ checkIn: '2026-10-07T06:30:00Z' }} />)
  expect(screen.getByRole('region', { name: 'Time worked card' })).toHaveTextContent('1h 30m')
  act(() => jest.advanceTimersByTime(60000))
  expect(screen.getByRole('region', { name: 'Time worked card' })).toHaveTextContent('1h 31m')
  view.rerender(<CheckInOutWidget {...base} todayAttendance={{ checkIn: '2026-10-07T06:30:00Z', checkOut: '2026-10-07T08:00:00Z' }} />)
  act(() => jest.advanceTimersByTime(60000))
  expect(screen.getByRole('region', { name: 'Time worked card' })).toHaveTextContent('1h 30m')
  expect(screen.getByRole('region', { name: 'Time worked card' })).toHaveTextContent('includes breaks')
})

test('schedule uses existing company times, timezone and target', () => {
  render(<CheckInOutWidget {...base} companySettings={{ timezone: 'Asia/Kolkata', workingHours: { checkInTime: '09:30', checkOutTime: '18:00', fullDayHours: 8 } }} />)
  const schedule = within(screen.getByRole('region', { name: 'Work schedule card' }))
  expect(schedule.getByText('9:30 am')).toBeInTheDocument()
  expect(schedule.getByText('6:00 pm')).toBeInTheDocument()
  expect(schedule.getByText('Asia/Kolkata')).toBeInTheDocument()
  expect(schedule.getByText('8h daily target')).toBeInTheDocument()
})

test('invalid attendance and schedule times do not display invented values', () => {
  render(<CheckInOutWidget {...base} todayAttendance={{ checkIn: 'bad' }} companySettings={{ workingHours: { checkInTime: '25:00', checkOutTime: '18:70' } }} />)
  expect(screen.getByRole('region', { name: 'Time worked card' })).toHaveTextContent('--:--')
  expect(screen.getByRole('region', { name: 'Work schedule card' })).toHaveTextContent('Not configured')
})

test('four cards occupy explicit two-by-two positions with location below', () => {
  const css = fs.readFileSync('components/widgets/CheckInOutWidget.module.css', 'utf8')
  expect(css).toContain('grid-template-rows: auto repeat(2, minmax(150px, 1fr))')
  expect(css).toContain('.duration { grid-column: 1; grid-row: 3; }')
  expect(css).toContain('.schedule { grid-column: 2; grid-row: 3; }')
  expect(css).toContain('.location { grid-column: 1 / -1; grid-row: 4; }')
})
