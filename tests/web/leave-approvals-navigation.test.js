import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import LeaveApprovalsPage from '@/app/dashboard/leave/approvals/page'
import useAuthedSWR from '@/hooks/useAuthedSWR'

let mockSearch = ''
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(mockSearch) }))
jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@/hooks/useApiMutation', () => ({ __esModule: true, default: () => ({}) }))
jest.mock('@/components/ui/HeroModal', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/ui/BackgroundRefreshIndicator', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/ui/LoadingButton', () => ({ __esModule: true, default: () => null, ApproveButton: () => null, RejectButton: () => null }))
jest.mock('@heroui/react', () => {
  const { Tabs, Tab } = jest.requireActual('@heroui/react')
  const Box = ({ children }) => <div>{children}</div>
  return { Tabs, Tab, Card: Box, CardBody: Box, Chip: Box, Skeleton: Box,
    Button: ({ children, onPress }) => <button onClick={onPress}>{children}</button> }
})

const originalResizeObserver = global.ResizeObserver
beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } })
afterAll(() => { global.ResizeObserver = originalResizeObserver })

beforeEach(() => {
  jest.clearAllMocks()
  mockSearch = ''
  useAuthedSWR.mockReturnValue({ data: { data: [] }, isLoading: false })
})

test.each([
  ['', 'pending'], ['status=all', ''], ['status=approved', 'approved'],
  ['status=rejected', 'rejected'], ['status=invalid', 'pending'],
])('initial filter respects safe navigation query %s', (query, status) => {
  mockSearch = query
  render(<LeaveApprovalsPage />)
  expect(useAuthedSWR).toHaveBeenCalledWith(`/api/leave?status=${status}`, { keepPreviousData: false })
})

test('tab selection overrides the incoming history filter', () => {
  mockSearch = 'status=all'
  render(<LeaveApprovalsPage />)
  fireEvent.click(screen.getByRole('tab', { name: 'Pending', exact: true }))
  expect(useAuthedSWR).toHaveBeenLastCalledWith('/api/leave?status=pending', { keepPreviousData: false })
})
