import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import DesktopPermissionGate, { hasRequiredDesktopPermissions } from '@/components/ui/DesktopPermissionGate'
import { readTalioDevicePermissions, requestTalioDevicePermission } from '@/lib/talioDevicePermissions'
jest.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))
jest.mock('@/lib/talioDevicePermissions', () => ({ readTalioDevicePermissions: jest.fn(), requestTalioDevicePermission: jest.fn() }))
beforeEach(() => {
  readTalioDevicePermissions.mockResolvedValue({ camera: 'granted', microphone: 'granted', location: 'granted' })
  requestTalioDevicePermission.mockResolvedValue()
  window.electronAPI = { miraPermissions: jest.fn(async () => ({ success: true, permissions: { platform: 'darwin', camera: 'granted', microphone: 'granted', screenRecording: 'granted', location: 'runtime' } })) }
})
afterEach(() => { delete window.electronAPI })
test('does not mount dashboard before required permissions are verified', async () => {
  render(<DesktopPermissionGate><div>Private dashboard</div></DesktopPermissionGate>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Allow' })).not.toBeDisabled())
  expect(screen.queryByText('Private dashboard')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
  await screen.findByText('Private dashboard')
  expect(requestTalioDevicePermission).toHaveBeenCalledWith('location')
})
test('denial keeps dashboard gated and exposes retry', async () => {
  requestTalioDevicePermission.mockRejectedValue(new Error('Location denied'))
  render(<DesktopPermissionGate><div>Private dashboard</div></DesktopPermissionGate>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Allow' })).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
  await screen.findByText('Location denied')
  expect(screen.queryByText('Private dashboard')).toBeNull()
})
test('browser is not gated and unknown or partial desktop statuses are not grants', async () => {
  delete window.electronAPI
  render(<DesktopPermissionGate><div>Browser dashboard</div></DesktopPermissionGate>)
  await screen.findByText('Browser dashboard')
  expect(hasRequiredDesktopPermissions(null)).toBe(false)
  expect(hasRequiredDesktopPermissions({ camera: 'granted', microphone: 'granted', location: 'granted', screenRecording: 'runtime' })).toBe(false)
})
