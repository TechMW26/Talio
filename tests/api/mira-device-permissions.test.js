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
test('macOS location and notifications only route to settings on explicit request', async () => {
  const { service, shell } = setup('darwin')
  await service.request('location'); await service.request('notifications')
  expect(shell.openExternal).not.toHaveBeenCalled()
  await service.request('location:settings'); await service.request('notifications:settings')
  expect(shell.openExternal).toHaveBeenCalledWith(expect.stringContaining('Privacy_LocationServices'))
  expect(shell.openExternal).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.notifications')
})

test('accessibility native prompt is not covered by an automatic Settings redirect', async () => {
  const { service, shell, systemPreferences } = setup('darwin')
  const result = await service.request('accessibility')
  expect(systemPreferences.isTrustedAccessibilityClient).toHaveBeenCalledWith(true)
  expect(result.requiresSettings).toBe(true)
  expect(shell.openExternal).not.toHaveBeenCalled()
})
test.each([0, 1, 2])('denied access uses a native fallback dialog; choice %s controls navigation', async response => {
  const { shell, systemPreferences } = setup('darwin')
  const dialog = { showMessageBox: jest.fn(async () => ({ response })) }
  const service = createMiraPermissions({ platform: 'darwin', shell, systemPreferences, dialog })
  const result = await service.request('microphone')
  expect(systemPreferences.askForMediaAccess).not.toHaveBeenCalled()
  expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ buttons: ['Not now', 'Open System Settings', 'Recheck access'] }))
  expect(shell.openExternal).toHaveBeenCalledTimes(response === 1 ? 1 : 0)
  expect(result.permissions.microphone).toBe('denied')
})
test('restricted access does not pretend a popup can override device policy', async () => {
  const { shell, systemPreferences } = setup('darwin')
  systemPreferences.getMediaAccessStatus.mockReturnValue('restricted')
  const dialog = { showMessageBox: jest.fn() }
  const service = createMiraPermissions({ platform: 'darwin', shell, systemPreferences, dialog })
  expect((await service.request('camera')).message).toContain('administrator')
  expect(dialog.showMessageBox).not.toHaveBeenCalled()
  expect(shell.openExternal).not.toHaveBeenCalled()
})
test('already granted access does not prompt or navigate', async () => {
  const { service, shell, systemPreferences } = setup('darwin')
  systemPreferences.getMediaAccessStatus.mockReturnValue('granted')
  expect((await service.request('microphone')).permissions.microphone).toBe('granted')
  expect(systemPreferences.askForMediaAccess).not.toHaveBeenCalled()
  expect(shell.openExternal).not.toHaveBeenCalled()
})
test('Linux reports runtime access honestly and provides guidance, not a fabricated settings command', async () => {
  const { service, shell } = setup('linux')
  expect(await service.request('location')).toMatchObject({ success: true, message: expect.stringContaining('Linux desktop Settings') })
  expect(shell.openExternal).not.toHaveBeenCalled()
  expect(await service.request('arbitrary')).toEqual({ success: false })
})

test('first macOS camera request uses native prompt without sending denial straight into Settings', async () => {
  const { service, shell, systemPreferences } = setup('darwin')
  systemPreferences.getMediaAccessStatus.mockReturnValue('not-determined')
  systemPreferences.askForMediaAccess.mockImplementation(async () => { systemPreferences.getMediaAccessStatus.mockReturnValue('denied'); return false })
  expect((await service.request('camera')).permissions.camera).toBe('denied')
  expect(systemPreferences.askForMediaAccess).toHaveBeenCalledWith('camera')
  expect(shell.openExternal).not.toHaveBeenCalled()
  await service.request('camera:settings')
  expect(shell.openExternal).toHaveBeenCalledWith(expect.stringContaining('Privacy_Camera'))
})

test('screen request enumerates through Electron but never claims macOS access from sources alone', async () => {
  const { shell, systemPreferences } = setup('darwin')
  const desktopCapturer = { getSources: jest.fn(async () => [{ id: 'screen:1' }]) }
  const service = createMiraPermissions({ platform: 'darwin', shell, systemPreferences, desktopCapturer })
  expect((await service.request('screenRecording')).permissions.screenRecording).toBe('denied')
  expect(desktopCapturer.getSources).toHaveBeenCalledWith(expect.objectContaining({ thumbnailSize: { width: 0, height: 0 } }))
  expect(shell.openExternal).not.toHaveBeenCalled()
})

test.each([0, 1, 2])('startup screen dialog respects native choice %s without forced Settings', async response => {
  const fs = require('fs')
  const vm = require('vm')
  const source = fs.readFileSync('desktop-app/src/main.js', 'utf8')
  const start = source.indexOf('async function promptScreenRecordingPermission(')
  const end = source.indexOf('\n/**', start)
  const window = { isDestroyed: () => false }
  const context = {
    process: { platform: 'darwin' }, mainWindow: window,
    dialog: { showMessageBox: jest.fn(async () => ({ response })) },
    desktopCapturer: { getSources: jest.fn(async () => []) },
    shell: { openExternal: jest.fn(async () => {}) },
    logger: { log: jest.fn() },
  }
  vm.runInNewContext(source.slice(start, end) + '\nthis.request = promptScreenRecordingPermission', context)
  await context.request(window)
  expect(context.desktopCapturer.getSources).toHaveBeenCalledTimes(response === 0 ? 1 : 0)
  expect(context.shell.openExternal).toHaveBeenCalledTimes(response === 1 ? 1 : 0)
  if (response === 0) expect(context.desktopCapturer.getSources).toHaveBeenCalledWith({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
})
