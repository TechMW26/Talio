const { createMiraComputer, validateComputerAction } = require('../../desktop-app/src/miraComputer')
const { createMiraPermissions, trustedMiraSender } = require('../../desktop-app/src/miraPermissions')

function harness() {
  const contents = { mainFrame: { url: 'https://app.talio.in/dashboard' } }
  const window = { webContents: contents, isDestroyed: () => false }
  const event = { sender: contents, senderFrame: contents.mainFrame }
  const deps = {
    platform: 'darwin', packaged: false,
    desktopCapturer: { getSources: jest.fn(async () => [{ display_id: '1', thumbnail: { isEmpty: () => false, toJPEG: () => Buffer.from('image') } }]) },
    screen: { getCursorScreenPoint: () => ({ x: 10, y: 10 }), getDisplayNearestPoint: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } }) },
    dialog: { showMessageBox: jest.fn(async () => ({ response: 1 })) },
    systemPreferences: { getMediaAccessStatus: () => 'granted', isTrustedAccessibilityClient: () => true },
    shell: { openExternal: jest.fn() }, globalShortcut: { register: jest.fn(() => true), unregister: jest.fn() },
    runControl: jest.fn(async () => ({ success: true, pid: 1, app: 'TextEdit' })),
  }
  const handler = createMiraComputer(deps)
  return { deps, event, window, call: input => handler(event, window, 'https://app.talio.in', input) }
}
test('native controls reject arbitrary commands, invalid coordinates and keys', () => {
  for (const action of [{ type: 'exec', command: 'anything' }, { type: 'click', x: 20, y: 0 }, { type: 'key', key: 'script' }, { type: 'open_app', name: 'foo;bar' }, { type: 'scroll', amount: 999 }]) expect(validateComputerAction(action)).toBeNull()
  expect(validateComputerAction({ type: 'click', x: .5, y: .3 })).toEqual({ type: 'click', x: .5, y: .3 })
})
test('one fresh observation permits one input, never a duplicate', async () => {
  const { call, deps } = harness()
  const start = await call({ operation: 'begin', goal: 'Open TextEdit' })
  const observed = await call({ operation: 'observe', sessionId: start.sessionId })
  const input = { operation: 'act', sessionId: start.sessionId, observationId: observed.observationId, action: { type: 'click', x: .5, y: .5 } }
  expect((await call(input)).success).toBe(true)
  expect(deps.runControl).toHaveBeenCalledWith({ type: 'click', x: 500, y: 400 })
  expect((await call(input)).success).toBe(false)
})
test('user cancellation and emergency stop prevent further observations', async () => {
  const { call, deps } = harness()
  const start = await call({ operation: 'begin', goal: 'Open TextEdit' })
  deps.globalShortcut.register.mock.calls[0][1]()
  expect((await call({ operation: 'observe', sessionId: start.sessionId })).success).toBe(false)
  expect(deps.desktopCapturer.getSources).not.toHaveBeenCalled()
})
test('native sender gate rejects child frames and other origins', () => {
  const { event, window } = harness()
  expect(trustedMiraSender(event, window, 'https://app.talio.in')).toBe(true)
  expect(trustedMiraSender({ ...event, senderFrame: { url: event.senderFrame.url } }, window, 'https://app.talio.in')).toBe(false)
  event.senderFrame.url = 'https://evil.example/dashboard'
  expect(trustedMiraSender(event, window, 'https://app.talio.in')).toBe(false)
})
test('permission requests only open allowlisted OS settings and recheck actual status', async () => {
  const shell = { openExternal: jest.fn() }
  const permissions = createMiraPermissions({ platform: 'darwin', shell, systemPreferences: { getMediaAccessStatus: () => 'denied', isTrustedAccessibilityClient: () => false } })
  expect(permissions.status().microphone).toBe('denied')
  await permissions.request('microphone')
  expect(shell.openExternal).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
  expect((await permissions.request('arbitrary')).success).toBe(false)
})
