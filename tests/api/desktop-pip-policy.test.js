const { pipWindowOptions } = require('../../desktop-app/src/pipWindowPolicy')
const origin = 'https://app.talio.in'
test('only the trusted app can create the named isolated live window', () => {
  const request = { url: 'about:blank', frameName: 'talio-live-pip' }
  expect(pipWindowOptions(request, origin + '/dashboard', origin)).toMatchObject({ action: 'allow', overrideBrowserWindowOptions: { frame: false, alwaysOnTop: true, transparent: true, backgroundColor: '#00000000', show: false, resizable: false, webPreferences: { nodeIntegration: false, contextIsolation: true, webSecurity: true } } })
  expect(pipWindowOptions(request, 'https://evil.example', origin)).toBeNull()
  expect(pipWindowOptions({ ...request, url: 'https://evil.example' }, origin, origin)).toBeNull()
  expect(pipWindowOptions({ ...request, frameName: 'other' }, origin, origin)).toBeNull()
})

test('desktop retains screenshot entitlements and enables real audio by default', () => {
  const fs = require('fs')
  const source = fs.readFileSync('desktop-app/src/main.js', 'utf8')
  expect(source).toContain("child.once('ready-to-show', () => { if (!child.isDestroyed()) child.showInactive(); });")
  expect(source).toContain("if (process.env.TALIO_LEGACY_AUDIO_FALLBACK !== 'true') return;")
  expect(source).toContain('screenshotService.resetPermissionError()')
  const entitlements = fs.readFileSync('desktop-app/build/entitlements.mac.plist', 'utf8')
  for (const permission of ['device.camera', 'device.microphone', 'personal-information.location', 'network.client']) expect(entitlements).toContain('com.apple.security.' + permission)
  expect(require('../../desktop-app/package.json').build.appId).toBe('in.talio.desktop')
})

const { pipBounds } = require('../../desktop-app/src/pipWindowPolicy')
test.each([
  [{ x: 0, y: 25, width: 1440, height: 815 }, { x: 1084, y: 644, width: 340, height: 180 }],
  [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: 1564, y: 844, width: 340, height: 180 }],
  [{ x: -1920, y: 0, width: 1872, height: 1080 }, { x: -404, y: 884, width: 340, height: 180 }],
])('places PiP inside the OS work area including alternate monitors', (workArea, expected) => {
  expect(pipBounds(workArea, { width: 340, height: 180 })).toEqual(expected)
})
test('clamps oversized live windows to the work area', () => {
  expect(pipBounds({ x: 0, y: 0, width: 300, height: 200 }, { width: 500, height: 800 })).toEqual({ x: 16, y: 16, width: 268, height: 168 })
})
test('restores a saved position and clamps it after a display/work-area change', () => {
  const area = { x: 0, y: 0, width: 1440, height: 815 }
  expect(pipBounds(area, { width: 340, height: 180 }, 16, { x: 240, y: 180 })).toEqual({ x: 240, y: 180, width: 340, height: 180 })
  expect(pipBounds(area, { width: 340, height: 180 }, 16, { x: 5000, y: -500 })).toEqual({ x: 1100, y: 0, width: 340, height: 180 })
})
