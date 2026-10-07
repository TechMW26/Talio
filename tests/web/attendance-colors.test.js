import fs from 'node:fs'
import { render, screen, fireEvent } from '@testing-library/react'
import AttendanceLegend, { ATTENDANCE_LEGEND } from '@/components/attendance/AttendanceLegend'
import MemberAttendance from '@/app/dashboard/team/members/[id]/MemberAttendance'
import useAuthedSWR from '@/hooks/useAuthedSWR'

jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@/app/dashboard/team/members/[id]/MemberProductivity', () => ({ __esModule: true, default: () => null }))

test('one labelled legend identifies every attendance colour without relying on colour alone', () => {
  render(<AttendanceLegend />)
  expect(screen.getByRole('list', { name: 'Attendance colour legend' })).toBeInTheDocument()
  for (const [, label] of ATTENDANCE_LEGEND) expect(screen.getByText(label)).toBeInTheDocument()
})

test('all attendance calendars opt into the same status palette and legend', () => {
  for (const file of ['app/dashboard/attendance/page.js', 'app/dashboard/attendance/team/page.js', 'app/dashboard/team/members/[id]/MemberAttendance.js']) {
    const source = fs.readFileSync(file, 'utf8')
    expect(source).toContain('attendance-colors.module.css')
    expect(source).toContain('attendanceColors.day')
    expect(source).toContain('attendanceColors.badge')
    expect(source).toContain('data-attendance-status=')
    expect(source).toContain('<AttendanceLegend />')
  }
  const css = fs.readFileSync('components/attendance/attendance-colors.module.css', 'utf8')
  for (const [status] of ATTENDANCE_LEGEND) {
    if (!['weekend', 'no-record'].includes(status)) expect(css).toContain(`[data-attendance-status="${status}"]`)
  }
  expect(css).toContain('[aria-pressed="true"]')
  expect(css).toContain('background: rgba(var(--attendance-rgb), .14) !important')
})

test('day status colours survive selection and missing records stay neutral', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-07T10:00:00Z'))
  useAuthedSWR.mockReturnValue({ data: { data: [
    { date: '2026-10-01', status: 'present' },
    { date: '2026-10-02', status: 'holiday' },
    { date: '2026-10-03', status: 'half-day' },
    { date: '2026-10-07', status: 'in-progress' },
  ] }, mutate: jest.fn() })
  render(<MemberAttendance employee={{ _id: 'employee-one' }} showProductivity={false} />)
  for (const [day, status] of [['01','present'], ['02','holiday'], ['03','half-day'], ['07','in-progress']]) {
    const button = screen.getByRole('button', { name: `2026-10-${day}: ${status.replaceAll('-', ' ')}` })
    expect(button).toHaveAttribute('data-attendance-status', status)
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-pressed', 'true')
  }
  expect(screen.getByRole('button', { name: '2026-10-04: no record' })).toHaveAttribute('data-attendance-status', 'no-record')
  jest.useRealTimers()
})
