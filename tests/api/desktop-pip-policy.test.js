const { pipWindowOptions } = require('../../desktop-app/src/pipWindowPolicy')
const origin = 'https://app.talio.in'
test('only the trusted app can create the named isolated live window', () => {
  const request = { url: 'about:blank', frameName: 'talio-live-pip' }
  expect(pipWindowOptions(request, origin + '/dashboard', origin)).toMatchObject({ action: 'allow', overrideBrowserWindowOptions: { frame: false, alwaysOnTop: true, webPreferences: { nodeIntegration: false, contextIsolation: true, webSecurity: true } } })
  expect(pipWindowOptions(request, 'https://evil.example', origin)).toBeNull()
  expect(pipWindowOptions({ ...request, url: 'https://evil.example' }, origin, origin)).toBeNull()
  expect(pipWindowOptions({ ...request, frameName: 'other' }, origin, origin)).toBeNull()
})

test('desktop retains screenshot entitlements and enables real audio by default', () => {
  const fs = require('fs')
  const source = fs.readFileSync('desktop-app/src/main.js', 'utf8')
  expect(source).toContain("if (process.env.TALIO_LEGACY_AUDIO_FALLBACK !== 'true') return;")
  expect(source).toContain('screenshotService.resetPermissionError()')
  const entitlements = fs.readFileSync('desktop-app/build/entitlements.mac.plist', 'utf8')
  for (const permission of ['device.camera', 'device.microphone', 'personal-information.location', 'network.client']) expect(entitlements).toContain('com.apple.security.' + permission)
  expect(require('../../desktop-app/package.json').build.appId).toBe('in.talio.desktop')
})
