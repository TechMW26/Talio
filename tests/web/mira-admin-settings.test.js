import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MiraAdminSettings from '@/components/settings/MiraAdminSettings'
import { saveMiraAccess, miraSettingsRequest } from '@/lib/client/miraSettings'

const mockMutate = jest.fn()
let mockCanManage = true
jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: path => path === '/api/mira/access'
  ? { data: { canManage: mockCanManage, settings: { enabled: true, allowedLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9] } }, mutate: mockMutate }
  : { data: { success: true, needsSync: false, agent: { syncedAt: '2026-10-12T00:00:00Z' } }, mutate: mockMutate } }))
jest.mock('@/lib/client/miraSettings', () => ({ saveMiraAccess: jest.fn(), miraSettingsRequest: jest.fn() }))
jest.mock('@/components/ui/fernly', () => ({
  Button: ({ children, onPress, isDisabled }) => <button disabled={isDisabled} onClick={onPress}>{children}</button>,
  Switch: ({ children, isSelected, isDisabled, onValueChange }) => <label><input role="switch" type="checkbox" checked={isSelected} disabled={isDisabled} onChange={event => onValueChange(event.target.checked)} />{children}</label>,
}))
beforeEach(() => { mockCanManage = true; jest.clearAllMocks(); saveMiraAccess.mockResolvedValue({ settings: { enabled: true, allowedLevels: [6] } }); miraSettingsRequest.mockResolvedValue({ success: true }) })
test('administrator receives master and nine accessible level switches', () => {
  render(<MiraAdminSettings />)
  expect(screen.getAllByRole('switch')).toHaveLength(10)
  expect(screen.getByRole('switch', { name: 'L6 · Manager' })).toBeChecked()
  expect(screen.getByText('Shared prompt is synced', { exact: false })).toBeVisible()
})
test('level selection saves without changing roles and keeps agent sync separate', async () => {
  render(<MiraAdminSettings />)
  fireEvent.click(screen.getByRole('switch', { name: 'L1 · Entry Level' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save access' }))
  await waitFor(() => expect(saveMiraAccess).toHaveBeenCalledWith({ enabled: true, allowedLevels: [2, 3, 4, 5, 6, 7, 8, 9] }))
  expect(miraSettingsRequest).not.toHaveBeenCalled()
})
test('non-administrators never receive organisation switches', () => {
  mockCanManage = false
  render(<MiraAdminSettings />)
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
})
