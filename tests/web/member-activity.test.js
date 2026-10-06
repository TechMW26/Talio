import { render, screen, fireEvent } from '@testing-library/react'
import MemberAttendance, { attendanceDayKey } from '@/app/dashboard/team/members/[id]/MemberAttendance'
import MemberTaskList from '@/app/dashboard/team/members/[id]/MemberTaskList'
import useAuthedSWR from '@/hooks/useAuthedSWR'
jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@/app/dashboard/team/members/[id]/MemberProductivity', () => ({ __esModule: true, default: ({ employee, date }) => <div data-testid="productivity">{employee._id}:{date}</div> }))
jest.mock('@/components/ui/ErrorBoundary', () => ({ DataErrorState: ({ message, onRetry }) => <button onClick={onRetry}>{message}</button> }))

test('attendance date keys retain date-only fields and respect company timezone', () => {
  expect(attendanceDayKey('2026-10-01', 'Asia/Kolkata')).toBe('2026-10-01')
  expect(attendanceDayKey('2026-09-30T19:00:00Z', 'Asia/Kolkata')).toBe('2026-10-01')
  expect(attendanceDayKey('broken', 'Asia/Kolkata')).toBeNull()
})
test('selected employee and day drive attendance details and productivity without marking missing days absent', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-06T10:00:00Z'))
  useAuthedSWR.mockReturnValue({ data: { data: [{ date: '2026-10-01', status: 'present', checkIn: '2026-10-01T04:00:00Z', workHours: 8, employee: { company: { timezone: 'Asia/Kolkata' } } }] }, mutate: jest.fn() })
  render(<MemberAttendance employee={{ _id: 'employee-one' }} />)
  expect(useAuthedSWR).toHaveBeenCalledWith('/api/attendance?employeeId=employee-one&month=10&year=2026', expect.objectContaining({ keepPreviousData: false }))
  fireEvent.click(screen.getByRole('button', { name: '2026-10-01: present' }))
  expect(screen.getByText('09:30')).toBeInTheDocument()
  expect(screen.getByTestId('productivity')).toHaveTextContent('employee-one:2026-10-01')
  fireEvent.click(screen.getByRole('button', { name: '2026-10-02: no record' }))
  expect(screen.getByText('No attendance record for this day.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '2026-10-07: no record' })).toBeDisabled()
  jest.useRealTimers()
})
test('task rows preserve assignment information and tolerate missing dates/status', () => {
  render(<MemberTaskList tasks={[{ _id: 't1', title: 'Design review', assignmentStatus: 'pending', dueDate: 'invalid', project: { name: 'Talio' }, assignedBy: { firstName: 'Alex' }, priority: 'high' }]} />)
  expect(screen.getByText('Awaiting acceptance')).toBeInTheDocument()
  expect(screen.getByText('No due date')).toBeInTheDocument()
  expect(screen.getByText('Assigned by Alex')).toBeInTheDocument()
  expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument()
})
