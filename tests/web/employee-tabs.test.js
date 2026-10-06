import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import EmployeeTabs from '@/app/dashboard/team/members/[id]/EmployeeTabs'
import MemberDetails from '@/app/dashboard/team/members/[id]/MemberDetails'
import useAuthedSWR from '@/hooks/useAuthedSWR'
jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
test('pills switch by click and keyboard with a single selected tab', () => {
  function Harness() { const [active, setActive] = useState('overview'); return <EmployeeTabs active={active} onChange={setActive} /> }
  render(<Harness />)
  fireEvent.click(screen.getByRole('tab', { name: 'Attendance' }))
  expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Attendance')
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Attendance' }), { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Productivity & screenshots')
  fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key: 'Home' })
  expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Overview')
})
test('asset panel filters to selected employee even if API response contains unrelated records', () => {
  useAuthedSWR.mockReturnValue({ data: { data: [{ _id: '1', assignedTo: { _id: 'a' }, name: 'Assigned laptop' }, { _id: '2', assignedTo: { _id: 'b' }, name: 'Other laptop' }] } })
  render(<MemberDetails employee={{ _id: 'a' }} assetsOnly />)
  expect(screen.getByText('Assigned laptop')).toBeTruthy()
  expect(screen.queryByText('Other laptop')).toBeNull()
})
test('asset restrictions remain explicit', () => {
  useAuthedSWR.mockReturnValue({ error: { status: 403 } })
  render(<MemberDetails employee={{ _id: 'a' }} assetsOnly />)
  expect(screen.getByRole('alert').textContent).toContain('permission')
})
