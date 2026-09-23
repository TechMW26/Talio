import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import TeamAttendanceWidget from '@/components/widgets/TeamAttendanceWidget'
import useAuthedSWR from '@/hooks/useAuthedSWR'
jest.mock('@/components/widgets/TeamAttendanceWidget.module.css', () => ({}))
jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
const push = jest.fn()
const mutate = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
const members = Array.from({ length: 9 }, (_, i) => ({
  _id: String(i), firstName: 'Member', lastName: String(i),
  status: i < 6 ? 'in-progress' : 'absent',
  checkIn: i < 6 ? '2026-09-23T05:00:00Z' : null,
}))
beforeEach(() => { jest.clearAllMocks(); useAuthedSWR.mockReturnValue({ data: { data: members }, mutate }) })

test('renders real totals and percentages, paginates all members and opens attendance', () => {
  render(<TeamAttendanceWidget />)
  expect(screen.getByLabelText('Present: 67% of team')).toBeInTheDocument()
  expect(screen.getByLabelText('Absent: 33% of team')).toBeInTheDocument()
  expect(screen.getAllByRole('listitem')).toHaveLength(4)
  expect(screen.getByRole('list', { name: 'Team attendance records' })).not.toHaveAttribute('tabindex')
  expect(screen.getByLabelText('Previous team members')).toBeDisabled()
  fireEvent.click(screen.getByLabelText('Next team members'))
  expect(screen.getByText('Member 7')).toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('Next team members'))
  expect(screen.getByText('Member 8')).toBeInTheDocument()
  expect(screen.getByLabelText('Next team members')).toBeDisabled()
  fireEvent.click(screen.getByText('View All'))
  expect(push).toHaveBeenCalledWith('/dashboard/attendance')
  expect(useAuthedSWR).toHaveBeenCalledWith('/api/attendance/team-today', { refreshInterval: 0 })
})

test('handles empty, loading and failed states without pretending errors are zero attendance', () => {
  useAuthedSWR.mockReturnValue({ isLoading: true })
  const view = render(<TeamAttendanceWidget />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading team attendance')
  expect(screen.getAllByText('–')).toHaveLength(3)
  useAuthedSWR.mockReturnValue({ data: { data: [] } })
  view.rerender(<TeamAttendanceWidget />)
  expect(screen.getByText('No team members to display.')).toBeInTheDocument()
  expect(screen.getByLabelText('Present: 0% of team')).toBeInTheDocument()
  useAuthedSWR.mockReturnValue({ error: new Error('offline'), mutate })
  view.rerender(<TeamAttendanceWidget />)
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(screen.getAllByText('–')).toHaveLength(3)
  fireEvent.click(screen.getByText('Retry'))
  expect(mutate).toHaveBeenCalledTimes(1)
})

test('clamps pagination after data shrinks and preserves holiday statuses', () => {
  const view = render(<TeamAttendanceWidget />)
  fireEvent.click(screen.getByLabelText('Next team members'))
  fireEvent.click(screen.getByLabelText('Next team members'))
  useAuthedSWR.mockReturnValue({ data: { data: [{ _id: '0', firstName: 'Member', status: 'holiday', checkIn: 'invalid' }] } })
  view.rerender(<TeamAttendanceWidget />)
  expect(screen.getByText('Holiday')).toBeInTheDocument()
  expect(screen.getByText('Showing 1–1 of 1 members')).toBeInTheDocument()
  expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument()
})

test('searches all pages case-insensitively without changing attendance totals', () => {
  render(<TeamAttendanceWidget />)
  fireEvent.click(screen.getByLabelText('Next team members'))
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search team members' }), { target: { value: '  MEMBER   8  ' } })
  expect(screen.getByText('Member 8')).toBeInTheDocument()
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  expect(screen.getByText('Showing 1–1 of 1 matching members')).toBeInTheDocument()
  expect(screen.getByLabelText('Present: 67% of team')).toBeInTheDocument()
  expect(screen.getByLabelText('Previous team members')).toBeDisabled()
  expect(screen.getByLabelText('Next team members')).toBeDisabled()
  fireEvent.click(screen.getByLabelText('Clear team search'))
  expect(screen.getByText('Member 0')).toBeInTheDocument()
  expect(screen.getAllByRole('listitem')).toHaveLength(4)
})

test('shows no matches and restores the list with Escape', () => {
  render(<TeamAttendanceWidget />)
  const search = screen.getByRole('searchbox')
  fireEvent.change(search, { target: { value: 'Nobody' } })
  expect(screen.getByRole('status')).toHaveTextContent('No team members match your search.')
  expect(screen.queryByLabelText('Next team members')).not.toBeInTheDocument()
  fireEvent.keyDown(search, { key: 'Escape' })
  expect(search).toHaveValue('')
  expect(screen.getByText('Showing 1–4 of 9 members')).toBeInTheDocument()
})
