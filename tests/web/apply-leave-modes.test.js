import { render, screen } from '@testing-library/react'
import ApplyLeavePage from '@/app/dashboard/leave/apply/page'
import useAuthedSWR from '@/hooks/useAuthedSWR'

jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@/hooks/useApiMutation', () => ({ __esModule: true, default: () => ({ execute: jest.fn(), isLoading: false }) }))
jest.mock('@/utils/userHelper', () => ({ getCurrentUser: () => ({ id: 'user' }), getEmployeeId: () => 'employee' }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }))
beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } })
beforeEach(() => useAuthedSWR.mockReturnValue({ data: { data: [] }, mutate: jest.fn() }))

test('Apply Leave has no half-day or WFH checkbox and no half-day balance request', () => {
  render(<ApplyLeavePage />)
  expect(screen.getByRole('heading', { name: 'Apply for Leave' })).toBeInTheDocument()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.queryByText('Half Day Leave')).not.toBeInTheDocument()
  expect(screen.queryByText('Work From Home')).not.toBeInTheDocument()
  expect(useAuthedSWR.mock.calls.flat().filter(value => typeof value === 'string').join(' ')).not.toContain('half-day-balance')
})

test('full-day submission requires a leave type and cannot switch request modes', () => {
  const source = require('fs').readFileSync('app/dashboard/leave/apply/page.js', 'utf8')
  expect(source).toContain("requestType: 'leave'")
  expect(source).toContain('isHalfDay: false')
  expect(source).toContain('workFromHome: false')
  expect(source).toContain("toast.error('Please select a leave type')")
  expect(source).not.toContain('formData.isHalfDay')
  expect(source).not.toContain('formData.workFromHome')
  expect(source).toContain('Insufficient leave balance')
})
