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
  expect(source).toContain('positionPip(); child.showInactive(); positionPip();')
  for (const event of ['show', 'move', 'moved']) expect(source).toContain(`child.on('${event}', positionPip)`)
  expect(source).toContain('Object.assign(pip.overrideBrowserWindowOptions, pipBounds(')
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

test('native lifecycle corrects late top-left placement and resize without stealing focus', () => {
  const { EventEmitter } = require('events')
  const vm = require('vm')
  const source = require('fs').readFileSync('desktop-app/src/main.js', 'utf8')
  const start = source.indexOf("  mainWindow.webContents.on('did-create-window'")
  const end = source.indexOf('  // Handle certificate errors', start)
  const mainWindow = Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(), isDestroyed: () => false,
    isFocused: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
  })
  const area = { x: 0, y: 25, width: 1440, height: 815 }
  const screen = Object.assign(new EventEmitter(), {
    getDisplayMatching: () => ({ workArea: area }), getDisplayNearestPoint: () => ({ workArea: area }),
  })
  let bounds = { x: 0, y: 0, width: 400, height: 120 }
  const child = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, getBounds: () => bounds,
    setParentWindow: jest.fn(),
    setBounds: jest.fn(value => { bounds = value; child.emit('move') }),
    setAlwaysOnTop: jest.fn(), setVisibleOnAllWorkspaces: jest.fn(), showInactive: jest.fn(),
    webContents: Object.assign(new EventEmitter(), { setWindowOpenHandler: jest.fn() }),
  })
  let saved = null
  const store = { get: () => saved }
  const app = { hide: jest.fn() }
  vm.runInNewContext(source.slice(start, end), { app, mainWindow, screen, store, pipBounds, process: { platform: 'darwin' }, setImmediate: fn => fn() })
  mainWindow.webContents.emit('did-create-window', child, { frameName: 'talio-live-pip' })
  expect(child.setParentWindow).toHaveBeenCalledWith(null)
  for (const event of ['show', 'move', 'moved', 'ready-to-show']) {
    bounds = { x: 0, y: 0, width: 400, height: 120 }
    child.emit(event)
    expect(bounds).toEqual({ x: 1024, y: 704, width: 400, height: 120 })
  }
  bounds = { ...bounds, height: 200 }
  child.emit('resize')
  expect(bounds.y).toBe(624)
  expect(child.showInactive).toHaveBeenCalledTimes(1)
  child.emit('closed')
  expect(app.hide).not.toHaveBeenCalled()
  expect(screen.listenerCount('display-metrics-changed')).toBe(0)
  child.removeAllListeners()
  saved = { x: 240, y: 180 }
  mainWindow.webContents.emit('did-create-window', child, { frameName: 'talio-live-pip' })
  expect(bounds).toMatchObject(saved)
  bounds = { ...bounds, x: 0, y: 0 }
  child.emit('show')
  expect(bounds).toMatchObject(saved)
  child.emit('closed')
  expect(app.hide).not.toHaveBeenCalled()
  child.removeAllListeners()
  saved = { x: 9000, y: -500 }
  mainWindow.webContents.emit('did-create-window', child, { frameName: 'talio-live-pip' })
  expect(bounds.x).toBe(1040)
  expect(bounds.y).toBe(25)
  child.emit('closed')
  expect(app.hide).not.toHaveBeenCalled()
})

test('closing desktop PiP while Talio is not focused does not reveal the dashboard on macOS', () => {
  const { EventEmitter } = require('events')
  const vm = require('vm')
  const source = require('fs').readFileSync('desktop-app/src/main.js', 'utf8')
  const start = source.indexOf("  mainWindow.webContents.on('did-create-window'")
  const end = source.indexOf('  // Handle certificate errors', start)
  const mainWindow = Object.assign(new EventEmitter(), { webContents: new EventEmitter(), isDestroyed: () => false, isFocused: () => false, getBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }) })
  const area = { x: 0, y: 0, width: 1440, height: 900 }
  const screen = Object.assign(new EventEmitter(), { getDisplayMatching: () => ({ workArea: area }), getDisplayNearestPoint: () => ({ workArea: area }) })
  const child = Object.assign(new EventEmitter(), { isDestroyed: () => false, getBounds: () => ({ x: 100, y: 100, width: 400, height: 120 }), setParentWindow: jest.fn(), setBounds: jest.fn(), setAlwaysOnTop: jest.fn(), setVisibleOnAllWorkspaces: jest.fn(), showInactive: jest.fn(), webContents: Object.assign(new EventEmitter(), { setWindowOpenHandler: jest.fn() }) })
  const app = { hide: jest.fn() }
  vm.runInNewContext(source.slice(start, end), { app, mainWindow, screen, store: { get: () => null }, pipBounds, process: { platform: 'darwin' }, setImmediate: fn => fn() })
  mainWindow.webContents.emit('did-create-window', child, { frameName: 'talio-live-pip' })
  child.emit('close')
  child.emit('closed')
  expect(app.hide).toHaveBeenCalledTimes(1)
})
