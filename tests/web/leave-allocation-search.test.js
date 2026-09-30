import { fireEvent, render, screen } from '@testing-library/react'
import LeaveAllocationsPage from '@/app/dashboard/leave/allocations/page'
import useAuthedSWR from '@/hooks/useAuthedSWR'

jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@/hooks/useApiMutation', () => ({ __esModule: true, default: () => ({ execute: jest.fn() }) }))
jest.mock('@/components/ui/BackgroundRefreshIndicator', () => () => null)
jest.mock('@/components/ui/LoadingButton', () => ({ children }) => <button>{children}</button>)
jest.mock('@heroui/react', () => {
  const Box = ({ children }) => <div>{children}</div>
  return {
    Card: Box, CardBody: Box, CardHeader: Box, Skeleton: Box, Chip: Box, Spinner: Box,
    Modal: () => null, ModalContent: Box, ModalHeader: Box, ModalBody: Box, ModalFooter: Box, Checkbox: Box,
    Button: ({ children, onPress, isDisabled }) => <button onClick={onPress} disabled={isDisabled}>{children}</button>,
    Input: ({ 'aria-label': label, value, onValueChange, label: visibleLabel, onClear, isClearable }) => <label>{visibleLabel}<input aria-label={label || visibleLabel} value={value ?? ''} onChange={event => onValueChange?.(event.target.value)} />{isClearable && value && <button onClick={onClear}>Clear input</button>}</label>,
    Select: ({ children, label }) => <label>{label}<select>{children}</select></label>,
    SelectItem: ({ children }) => <option>{children}</option>,
  }
})

beforeEach(() => {
  localStorage.clear()
  useAuthedSWR.mockImplementation(url => ({ data: { data: url.startsWith('/api/employees') ? [
    { _id: '1', firstName: 'Aman', lastName: 'Tiwari', employeeCode: 'D1' },
    { _id: '2', firstName: 'Diksha', lastName: 'Widhani', employeeCode: 'D5' },
    { _id: '3', firstName: 'Test', employeeCode: 'T-0001' },
  ] : [] }, mutate: jest.fn() }))
})

test('filters balances by case-insensitive names, whitespace-separated terms, and employee code', () => {
  render(<LeaveAllocationsPage />)
  const search = screen.getByRole('textbox', { name: 'Search employee leave balances' })
  fireEvent.change(search, { target: { value: '  TIWARI   aman ' } })
  expect(screen.getByText('Aman Tiwari')).toBeInTheDocument()
  expect(screen.queryByText('Diksha Widhani')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 3 employees')
  fireEvent.change(search, { target: { value: 'd5' } })
  expect(screen.getByText('Diksha Widhani')).toBeInTheDocument()
  expect(screen.queryByText('Aman Tiwari')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clear input' }))
  expect(screen.getByRole('status')).toHaveTextContent('Showing 3 of 3 employees')
})

test('handles no matches and clearing without changing underlying employee totals', () => {
  render(<LeaveAllocationsPage />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Search employee leave balances' }), { target: { value: 'missing' } })
  expect(screen.getByText('No employees match your search.')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Showing 0 of 3 employees')
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(screen.getByText('Aman Tiwari')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Allocate' })).toHaveLength(3)
})
