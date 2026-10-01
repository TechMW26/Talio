import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import DesktopPermissionGate, { hasRequiredDesktopPermissions } from '@/components/ui/DesktopPermissionGate'
import { readTalioDevicePermissions, requestTalioDevicePermission } from '@/lib/talioDevicePermissions'
jest.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))
jest.mock('@/lib/talioDevicePermissions', () => ({ readTalioDevicePermissions: jest.fn(), requestTalioDevicePermission: jest.fn() }))
beforeEach(() => {
  jest.clearAllMocks()
  readTalioDevicePermissions.mockResolvedValue({ camera: 'granted', microphone: 'granted', location: 'granted' })
  requestTalioDevicePermission.mockResolvedValue()
  window.electronAPI = { miraPermissions: jest.fn(async () => ({ success: true, permissions: { platform: 'darwin', camera: 'granted', microphone: 'granted', screenRecording: 'granted', location: 'runtime' } })) }
})
afterEach(() => { delete window.electronAPI })
test('does not flash setup while the initial permission read is pending', async () => {
  let resolve
  window.electronAPI.miraPermissions.mockReturnValue(new Promise(done => { resolve = done }))
  render(<DesktopPermissionGate><div>Private dashboard</div></DesktopPermissionGate>)
  expect(screen.queryByText('Set up Talio permissions')).not.toBeInTheDocument()
  expect(screen.queryByText('Private dashboard')).not.toBeInTheDocument()
  await act(async () => resolve({ success: true, permissions: { camera: 'granted', microphone: 'granted', screenRecording: 'granted' } }))
  expect(screen.getByText('Private dashboard')).toBeInTheDocument()
  expect(screen.queryByText('Set up Talio permissions')).not.toBeInTheDocument()
})
test('does not mount dashboard before required permissions are verified', async () => {
  window.electronAPI.miraPermissions.mockImplementation(async kind => ({ success: true, permissions: { platform: 'darwin', camera: kind === 'camera' ? 'granted' : 'not-determined', microphone: 'granted', screenRecording: 'granted', location: 'denied' } }))
  render(<DesktopPermissionGate><div>Private dashboard</div></DesktopPermissionGate>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Allow' })).not.toBeDisabled())
  expect(screen.queryByText('Private dashboard')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
  await screen.findByText('Private dashboard')
  expect(window.electronAPI.miraPermissions).toHaveBeenCalledWith('camera')
  expect(requestTalioDevicePermission).not.toHaveBeenCalled()
})
test('denial keeps dashboard gated and exposes retry', async () => {
  window.electronAPI.miraPermissions.mockResolvedValue({ success: true, permissions: { platform: 'win32', camera: 'runtime', microphone: 'granted', screenRecording: 'granted' } })
  requestTalioDevicePermission.mockRejectedValue(new Error('Camera denied'))
  render(<DesktopPermissionGate><div>Private dashboard</div></DesktopPermissionGate>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Allow' })).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
  await screen.findByText('Camera denied')
  expect(screen.queryByText('Private dashboard')).toBeNull()
})
test.each(['denied', 'runtime', 'not-determined', undefined])('location %s does not block the dashboard or trigger a request', async location => {
  window.electronAPI.miraPermissions.mockResolvedValue({ success: true, permissions: { platform: 'darwin', camera: 'granted', microphone: 'granted', screenRecording: 'granted', location } })
  readTalioDevicePermissions.mockResolvedValue({ camera: 'granted', microphone: 'granted', location })
  render(<DesktopPermissionGate><div>Private dashboard</div></DesktopPermissionGate>)
  await screen.findByText('Private dashboard')
  expect(requestTalioDevicePermission).not.toHaveBeenCalled()
  expect(window.electronAPI.miraPermissions).not.toHaveBeenCalledWith('location')
})
test('browser is not gated and unknown or partial desktop statuses are not grants', async () => {
  delete window.electronAPI
  render(<DesktopPermissionGate><div>Browser dashboard</div></DesktopPermissionGate>)
  await screen.findByText('Browser dashboard')
  expect(hasRequiredDesktopPermissions(null)).toBe(false)
  expect(hasRequiredDesktopPermissions({ camera: 'granted', microphone: 'granted', location: 'granted', screenRecording: 'runtime' })).toBe(false)
})
