import { render, screen, fireEvent } from '@testing-library/react'
import MemberLifecycle from '@/app/dashboard/team/members/[id]/MemberLifecycle'
import useAuthedSWR from '@/hooks/useAuthedSWR'
jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
test('filters lifecycle records and refreshes on demand', () => {
  const mutate = jest.fn()
  useAuthedSWR.mockReturnValue({ mutate, data: { data: { stage: 'probation', progress: null, events: [{ id: 'p', category: 'pip', title: 'Performance improvement plan', at: null, status: 'approved', detail: 'Training' }, { id: 'a', category: 'appraisal', title: 'Annual appraisal', status: 'pending' }] } } })
  render(<MemberLifecycle employeeId="test" />)
  expect(screen.getByText('No onboarding checklist recorded')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'PIPs', exact: true }))
  expect(screen.queryByText('Annual appraisal')).toBeNull()
  expect(screen.getByText('Performance improvement plan')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh lifecycle history' }))
  expect(mutate).toHaveBeenCalledTimes(1)
})
test('restricted access is not rendered as an empty history', () => {
  useAuthedSWR.mockReturnValue({ error: { status: 403 } })
  render(<MemberLifecycle employeeId="test" />)
  expect(screen.getByRole('alert').textContent).toContain('permission')
  expect(screen.queryByText('No recorded lifecycle events.')).toBeNull()
})
