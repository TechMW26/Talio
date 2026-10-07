import { render, screen, fireEvent } from '@testing-library/react'
import ExpensesPage from '@/app/dashboard/expenses/page'
import useAuthedSWR from '@/hooks/useAuthedSWR'

jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@/hooks/useApiMutation', () => ({ __esModule: true, default: () => ({ execute: jest.fn(), isLoading: false }) }))
jest.mock('@/contexts/SocketContext', () => ({ useSocket: () => ({}), REALTIME_EVENTS: {} }))
jest.mock('@/utils/userHelper', () => ({ getCurrentUser: () => ({ id: 'user' }), getEmployeeId: () => 'employee' }))
beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } })
beforeEach(() => { useAuthedSWR.mockReturnValue({ data: { data: [] }, mutate: jest.fn() }) })

test('plain summary labels and Fernly surfaces render without heading icons', () => {
  render(<ExpensesPage />)
  for (const label of ['Total Expenses', 'Approved', 'Pending', 'Rejected']) {
    const card = screen.getByRole('region', { name: label })
    expect(card).toHaveTextContent(label)
    expect(card.querySelector('svg')).toBeNull()
  }
  expect(screen.getByRole('table', { name: 'My Expenses' })).toBeInTheDocument()
  expect(screen.getByText('No expenses found')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Submit Expense' }))
  expect(screen.getByPlaceholderText('Enter expense details')).toBeInTheDocument()
})

test('real totals and status labels are preserved', () => {
  useAuthedSWR.mockReturnValue({ data: { data: [
    { _id: '1', amount: 125, status: 'approved', category: 'travel', description: 'Taxi' },
    { _id: '2', amount: 75, status: 'pending', category: 'food', description: 'Lunch' },
    { _id: '3', amount: 50, status: 'rejected', category: 'fuel', description: 'Fuel' },
  ] }, mutate: jest.fn() })
  render(<ExpensesPage />)
  expect(screen.getByRole('region', { name: 'Total Expenses' })).toHaveTextContent('₹250.00')
  expect(screen.getByRole('region', { name: 'Approved' })).toHaveTextContent('₹125.00')
  expect(screen.getByRole('region', { name: 'Pending' })).toHaveTextContent('₹75.00')
  expect(screen.getByRole('region', { name: 'Rejected' })).toHaveTextContent('1')
  expect(screen.getByText('approved')).toBeInTheDocument()
})

test('errors keep retry available and do not display misleading zero totals', () => {
  const mutate = jest.fn()
  useAuthedSWR.mockReturnValue({ error: new Error('Offline'), mutate })
  render(<ExpensesPage />)
  expect(screen.getByText('Failed to load expenses')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Total Expenses' })).toHaveTextContent('—')
})

test('expense styling uses shared cards and chips with no hover treatment', () => {
  const fs = require('fs')
  const source = fs.readFileSync('app/dashboard/expenses/page.js', 'utf8')
  const css = fs.readFileSync('app/dashboard/expenses/expenses.module.css', 'utf8')
  expect(source).toContain('<Card')
  expect(source).toContain('<Chip')
  expect(source).not.toMatch(/FaMoneyBillWave|FaCheckCircle|FaClock|FaTimesCircle|hover:/)
  expect(css).toContain('var(--color-border')
  expect(css).not.toContain(':hover')
})
