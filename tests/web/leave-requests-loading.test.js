import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import LeaveRequestsWidget from '@/components/widgets/LeaveRequestsWidget'
import useAuthedSWR from '@/hooks/useAuthedSWR'
jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
const push = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
jest.mock('@heroui/react', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardBody: ({ children }) => <div>{children}</div>,
  Button: ({ children, onPress }) => <button onClick={onPress}>{children}</button>,
  Chip: ({ children }) => <span>{children}</span>,
  Avatar: ({ name }) => <span>{name}</span>,
  ScrollShadow: ({ children }) => <div>{children}</div>,
}))
beforeEach(() => jest.clearAllMocks())
test('pending request is loading, never a false empty state', () => {
  useAuthedSWR.mockReturnValue({})
  render(<LeaveRequestsWidget />)
  expect(useAuthedSWR).toHaveBeenCalledWith('/api/dashboard/leave-requests')
  expect(screen.getByRole('status')).toHaveTextContent('Loading leave requests')
  expect(screen.queryByText('No leave requests found')).not.toBeInTheDocument()
})
test('failed response offers a functioning retry without claiming no requests', () => {
  const mutate = jest.fn()
  useAuthedSWR.mockReturnValue({ error: new Error('Unavailable'), mutate })
  render(<LeaveRequestsWidget />)
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to load')
  expect(screen.queryByText('No leave requests found')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(mutate).toHaveBeenCalledTimes(1)
})
test('successful API records reach the widget and view-all navigation', () => {
  useAuthedSWR.mockReturnValue({ data: { success: true, data: [{ _id: 'leave', employee: { firstName: 'Asha', lastName: 'Singh' }, leaveType: { name: 'Annual' }, numberOfDays: 2, status: 'pending' }] } })
  render(<LeaveRequestsWidget />)
  expect(screen.getByText('Asha Singh')).toBeInTheDocument()
  expect(screen.getByText('Annual - 2 day(s)')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'View All' }))
  expect(push).toHaveBeenCalledWith('/dashboard/leave/approvals')
})
test('successful zero rows is the only initial empty state', () => {
  useAuthedSWR.mockReturnValue({ data: { success: true, data: [] } })
  render(<LeaveRequestsWidget />)
  expect(screen.getByText('No leave requests found')).toBeInTheDocument()
})
test('completed requests remain visible with an explicit recent-history label', () => {
  useAuthedSWR.mockReturnValue({ data: { success: true, view: 'recent', data: [{ _id: 'approved', employee: { firstName: 'Asha' }, status: 'approved' }] } })
  render(<LeaveRequestsWidget />)
  expect(screen.getByText('Recent requests · no pending approvals')).toBeInTheDocument()
  expect(screen.getByText('approved')).toBeInTheDocument()
  expect(screen.queryByText('No leave requests found')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'View All' }))
  expect(push).toHaveBeenCalledWith('/dashboard/leave/approvals?status=all')
})
test('refresh failure retains already-loaded request cards', () => {
  useAuthedSWR.mockReturnValue({ error: new Error('offline'), data: { data: [{ _id: 'leave', employee: { firstName: 'Asha' }, status: 'pending' }] } })
  render(<LeaveRequestsWidget />)
  expect(screen.getByText('Asha')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toBeInTheDocument()
})
