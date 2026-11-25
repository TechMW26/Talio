import { render, screen, fireEvent } from '@testing-library/react'
import ApplyLeavePage from '@/app/dashboard/leave/apply/page'
import useAuthedSWR from '@/hooks/useAuthedSWR'

jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@/hooks/useApiMutation', () => ({ __esModule: true, default: () => ({ execute: jest.fn(), isLoading: false }) }))
jest.mock('@/utils/userHelper', () => ({ getCurrentUser: () => ({ id: 'user' }), getEmployeeId: () => 'employee' }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }))
beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } })
beforeEach(() => useAuthedSWR.mockReturnValue({ data: { data: [] }, mutate: jest.fn() }))

test('Apply Leave offers a half-day option but no WFH, and no extra half-day balance request', () => {
  render(<ApplyLeavePage />)
  expect(screen.getByRole('heading', { name: 'Apply for Leave' })).toBeInTheDocument()
  expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  expect(screen.getByText('Half Day Leave (0.5 day)')).toBeInTheDocument()
  expect(screen.queryByText('Work From Home')).not.toBeInTheDocument()
  expect(useAuthedSWR.mock.calls.flat().filter(value => typeof value === 'string').join(' ')).not.toContain('half-day-balance')
})

test('ticking Half Day asks for one date and which half instead of an end date', () => {
  render(<ApplyLeavePage />)
  expect(screen.getAllByText('End Date').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('checkbox'))
  expect(screen.queryAllByText('End Date')).toHaveLength(0)
  expect(screen.getAllByText('Which half').length).toBeGreaterThan(0)
})

test('submission requires a leave type and sends half day as a single-date half_day request', () => {
  const source = require('fs').readFileSync('app/dashboard/leave/apply/page.js', 'utf8')
  expect(source).toContain("requestType: formData.isHalfDay ? 'half_day' : 'leave'")
  expect(source).toContain('endDate: formData.startDate, halfDayPeriod')
  expect(source).toContain('workFromHome: false')
  expect(source).toContain("toast.error('Please select a leave type')")
  expect(source).not.toContain('formData.workFromHome')
  expect(source).toContain('Insufficient leave balance')
})
