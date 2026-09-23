import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import KPIStatsWidget from '@/components/widgets/KPIStatsWidget'
import LeaveRequestsWidget from '@/components/widgets/LeaveRequestsWidget'
import QuickActionsWidget from '@/components/widgets/QuickActionsWidget'
const push = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
jest.mock('@/contexts/CompanyFeaturesContext', () => ({ useCompanyFeatures: () => ({ isFeatureEnabled: key => key !== 'payroll' }) }))
jest.mock('@heroui/react', () => ({
  Card: ({ children, isPressable, onPress, className, ...props }) => isPressable
    ? <button className={className} onClick={onPress}>{children}</button>
    : <div className={className}>{children}</div>,
  CardBody: ({ children }) => <div>{children}</div>,
  Button: ({ children, onPress, className, 'aria-label': label }) => <button className={className} aria-label={label} onClick={onPress}>{children}</button>,
  Chip: ({ children }) => <span>{children}</span>,
  Avatar: ({ name }) => <span>{name}</span>,
  ScrollShadow: ({ children }) => <div>{children}</div>,
}))
beforeEach(() => jest.clearAllMocks())
test('restyled statistics retain navigation and values', () => {
  render(<KPIStatsWidget statsData={[{ title: 'Employees', value: 170, href: '/dashboard/employees', icon: () => <svg /> }]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Employees 170' }))
  expect(push).toHaveBeenCalledWith('/dashboard/employees')
})
test('restyled leave rows preserve approve and reject handlers', () => {
  const onApprove = jest.fn(), onReject = jest.fn()
  render(<LeaveRequestsWidget leaveRequests={[{ _id: 'leave-1', employee: { firstName: 'Test', lastName: 'Person' }, status: 'pending', numberOfDays: 2, leaveType: { name: 'Annual' } }]} onApprove={onApprove} onReject={onReject} />)
  fireEvent.click(screen.getByLabelText('Approve'))
  fireEvent.click(screen.getByLabelText('Reject'))
  expect(onApprove).toHaveBeenCalledWith('leave-1')
  expect(onReject).toHaveBeenCalledWith('leave-1')
})
test('quick action cards preserve feature restrictions and destination', () => {
  render(<QuickActionsWidget />)
  expect(screen.queryByText('Payroll')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Request Leave'))
  expect(push).toHaveBeenCalledWith('/dashboard/leave/requests')
})

test('quick actions put decorative icons before larger left-aligned labels', () => {
  render(<QuickActionsWidget />)
  for (const label of ['Request Leave', 'My Tasks', 'Travel Request', 'Documents', 'My Profile']) {
    const button = screen.getByRole('button', { name: label })
    expect(button).toHaveClass('flex-row', 'justify-start', 'text-left')
    expect(button.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(button.lastElementChild).toHaveClass('text-base', 'sm:text-lg', 'font-semibold')
  }
})
