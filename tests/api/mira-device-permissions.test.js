const { createMiraPermissions } = require('../../desktop-app/src/miraPermissions')
function setup(platform) {
  const shell = { openExternal: jest.fn().mockResolvedValue() }
  const systemPreferences = { getMediaAccessStatus: jest.fn(() => 'denied'), isTrustedAccessibilityClient: jest.fn(() => false), askForMediaAccess: jest.fn() }
  return { shell, systemPreferences, service: createMiraPermissions({ platform, shell, systemPreferences }) }
}
test('Windows reports actual media status and exposes location/notification checks', () => {
  const { service, systemPreferences } = setup('win32')
  expect(service.status()).toMatchObject({ microphone: 'denied', camera: 'denied', location: 'runtime', notifications: 'runtime' })
  expect(systemPreferences.getMediaAccessStatus).toHaveBeenCalledWith('microphone')
})
test.each([['location', 'ms-settings:privacy-location'], ['notifications', 'ms-settings:notifications'], ['camera', 'ms-settings:privacy-webcam'], ['microphone', 'ms-settings:privacy-microphone']])('opens Windows settings for %s without claiming grant', async (kind, url) => {
  const { service, shell } = setup('win32')
  const result = await service.request(kind)
  expect(shell.openExternal).toHaveBeenCalledWith(url)
  expect(result.permissions[kind]).not.toBe('granted')
})
test('macOS location and notifications route to system settings', async () => {
  const { service, shell } = setup('darwin')
  await service.request('location'); await service.request('notifications')
  expect(shell.openExternal).toHaveBeenCalledWith(expect.stringContaining('Privacy_LocationServices'))
  expect(shell.openExternal).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.notifications')
})
test('Linux reports runtime access honestly and provides guidance, not a fabricated settings command', async () => {
  const { service, shell } = setup('linux')
  expect(await service.request('location')).toMatchObject({ success: true, message: expect.stringContaining('Linux desktop Settings') })
  expect(shell.openExternal).not.toHaveBeenCalled()
  expect(await service.request('arbitrary')).toEqual({ success: false })
})
