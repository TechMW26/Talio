const { createMiraComputer, validateComputerAction } = require('../../desktop-app/src/miraComputer')
const { createMiraPermissions, trustedMiraSender } = require('../../desktop-app/src/miraPermissions')

function harness(overrides = {}) {
  const contents = { mainFrame: { url: 'https://app.talio.in/dashboard' } }
  const window = { webContents: contents, isDestroyed: () => false }
  const event = { sender: contents, senderFrame: contents.mainFrame }
  const deps = {
    platform: 'darwin', packaged: false,
    store: { get: jest.fn(() => true) },
    pointer: { show: jest.fn(), hide: jest.fn(), moveTo: jest.fn() },
    desktopCapturer: { getSources: jest.fn(async () => [{ display_id: '1', thumbnail: { isEmpty: () => false, toJPEG: () => Buffer.from('image') } }]) },
    screen: { getCursorScreenPoint: () => ({ x: 10, y: 10 }), getDisplayNearestPoint: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } }) },
    dialog: { showMessageBox: jest.fn(async () => ({ response: 1 })) },
    systemPreferences: { getMediaAccessStatus: () => 'granted', isTrustedAccessibilityClient: () => true },
    shell: { openExternal: jest.fn() }, globalShortcut: { register: jest.fn(() => true), unregister: jest.fn() },
    runControl: jest.fn(async () => ({ success: true, pid: 1, app: 'TextEdit' })),
    ...overrides,
  }
  const handler = createMiraComputer(deps)
  return { deps, event, window, call: input => handler(event, window, 'https://app.talio.in', input) }
}
test('old session cancellation and observations cannot stop a replacement session', async () => {
  const { call } = harness()
  const first = await call({ operation: 'begin', goal: 'Open WhatsApp' })
  await call({ operation: 'cancel', sessionId: first.sessionId })
  const second = await call({ operation: 'begin', goal: 'Open Notes' })
  await call({ operation: 'cancel', sessionId: first.sessionId })
  expect((await call({ operation: 'observe', sessionId: first.sessionId })).success).toBe(false)
  expect((await call({ operation: 'observe', sessionId: second.sessionId })).success).toBe(true)
  await call({ operation: 'cancel', sessionId: second.sessionId })
})
test('local planner consumes native observations and relays only expected model replies', async () => {
  const agentS = { begin: jest.fn(async () => ({ kind: 'ready' })), stop: jest.fn(), predict: jest.fn(async () => ({ kind: 'model_request', messages: [] })), respond: jest.fn(async () => ({ kind: 'result', action: { type: 'key', key: 'find' } })) }
  const { call } = harness({ agentS })
  const start = await call({ operation: 'begin', goal: 'Find a contact in WhatsApp' })
  expect(start.planner).toBe('agent-s-local')
  expect(agentS.begin).not.toHaveBeenCalled()
  const observation = await call({ operation: 'observe', sessionId: start.sessionId })
  const args = { sessionId: start.sessionId, observationId: observation.observationId }
  expect((await call({ ...args, operation: 'plan', image: 'untrusted renderer image' })).kind).toBe('model_request')
  expect(agentS.begin).toHaveBeenCalledWith('Find a contact in WhatsApp')
  expect(agentS.predict).toHaveBeenCalledWith({ image: Buffer.from('image').toString('base64'), app: expect.stringContaining('TextEdit') })
  expect((await call({ ...args, operation: 'model_response', text: 'agent.key("find")' })).action.type).toBe('key')
  expect((await call({ ...args, operation: 'model_response', text: 'unsolicited' })).success).toBe(false)
  expect(agentS.stop).toHaveBeenCalled()
})
test('locked desktop never begins or captures screenshots', async () => {
  const { call, deps } = harness({ isLocked: () => true })
  expect((await call({ operation: 'begin', goal: 'Open WhatsApp' })).success).toBe(false)
  expect(deps.runControl).not.toHaveBeenCalled()
  expect(deps.desktopCapturer.getSources).not.toHaveBeenCalled()
})
test('native app opening is independent of a failing planner startup', async () => {
  const agentS = { begin: jest.fn(async () => { throw new Error('Planner unavailable') }), stop: jest.fn() }
  const { call, deps } = harness({ agentS })
  const start = await call({ operation: 'begin', goal: 'Open Notes' })
  expect(start.success).toBe(true)
  const observation = await call({ operation: 'observe', sessionId: start.sessionId })
  expect((await call({ operation: 'act', sessionId: start.sessionId, observationId: observation.observationId, action: { type: 'open_app', name: 'Notes' } })).success).toBe(true)
  expect(deps.runControl).toHaveBeenCalledWith({ type: 'open_app', name: 'Notes' })
  expect(agentS.begin).not.toHaveBeenCalled()
  await call({ operation: 'cancel', sessionId: start.sessionId })
})
test.each(['cmd.exe', 'pwsh.exe', 'WindowsTerminal.exe', 'regedit.exe', '1Password', 'Bitwarden'])('protected application %s refuses generated input', async app => {
  const { call, deps } = harness({ runControl: jest.fn(async () => ({ success: true, pid: 1, app })) })
  const start = await call({ operation: 'begin', goal: 'Desktop task' })
  const observation = await call({ operation: 'observe', sessionId: start.sessionId })
  const result = await call({ operation: 'act', sessionId: start.sessionId, observationId: observation.observationId, action: { type: 'key', key: 'enter' } })
  expect(result.success).toBe(false)
  expect(deps.runControl.mock.calls.every(([action]) => action.type === 'status')).toBe(true)
})
test.each(['win32', 'linux'])('desktop consent is required and available on %s', async platform => {
  const store = { get: jest.fn(() => false), set: jest.fn() }
  const permissions = createMiraPermissions({ platform, store, dialog: { showMessageBox: async () => ({ response: 1 }) } })
  expect(permissions.status().desktopControl).toBe('denied')
  await permissions.request('desktopControl')
  expect(store.set).toHaveBeenCalledWith('miraDesktopConsentV1', true)
})
test.each(['win32', 'linux'])('uses a non-reserved emergency shortcut on %s', async platform => {
  const { call, deps } = harness({ platform })
  const result = await call({ operation: 'begin', goal: 'Open WhatsApp' })
  expect(result.success).toBe(true)
  expect(deps.globalShortcut.register).toHaveBeenCalledWith('Control+Alt+Shift+Escape', expect.any(Function))
  await call({ operation: 'cancel' })
})
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
  expect(deps.pointer.moveTo).toHaveBeenCalledWith({ x: 500, y: 400 })
  expect((await call(input)).success).toBe(false)
  expect(deps.pointer.moveTo).toHaveBeenCalledTimes(1)
})
test('user cancellation and emergency stop prevent further observations', async () => {
  const { call, deps } = harness()
  const start = await call({ operation: 'begin', goal: 'Open TextEdit' })
  deps.globalShortcut.register.mock.calls[0][1]()
  expect((await call({ operation: 'observe', sessionId: start.sessionId })).success).toBe(false)
  expect(deps.desktopCapturer.getSources).not.toHaveBeenCalled()
})
test('prepares each window once and restores its saved geometry on cancellation', async () => {
  const state = { pid: 1, index: 0, frame: { x: 10, y: 10, width: 300, height: 200 } }
  const { call, deps } = harness({ runControl: jest.fn(async action => action.type === 'prepare_window' ? { success: true, state } : { success: true, pid: 1, app: 'Notes', windowId: '1:0', center: { x: 500, y: 400 } }) })
  const start = await call({ operation: 'begin', goal: 'Read Notes' })
  await call({ operation: 'observe', sessionId: start.sessionId })
  await call({ operation: 'observe', sessionId: start.sessionId })
  await call({ operation: 'cancel', sessionId: start.sessionId })
  expect(deps.runControl.mock.calls.filter(([a]) => a.type === 'prepare_window')).toHaveLength(1)
  expect(deps.runControl).toHaveBeenCalledWith({ type: 'restore_window', state })
})
test('mouse movement alone does not stop the desktop session', async () => {
  let cursor = { x: 10, y: 10 }
  const { call, deps } = harness({ screen: { getCursorScreenPoint: () => cursor, getDisplayNearestPoint: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } }) } })
  const start = await call({ operation: 'begin', goal: 'Read Notes' })
  const obs = await call({ operation: 'observe', sessionId: start.sessionId })
  cursor = { x: 60, y: 10 }
  expect((await call({ operation: 'act', sessionId: start.sessionId, observationId: obs.observationId, action: { type: 'click', x: .5, y: .5 } })).success).toBe(true)
  expect(deps.runControl.mock.calls.some(([a]) => a.type === 'click')).toBe(true)
  await call({ operation: 'cancel', sessionId: start.sessionId })
})
test('window layout changes re-observe without executing stale input or ending the session', async () => {
  let frame = { x: 0, y: 0, width: 800, height: 600 }
  const runControl = jest.fn(async () => ({ success: true, pid: 1, windowId: 'one', frame, app: 'Notes', keyIdleSeconds: 999 }))
  const { call } = harness({ runControl })
  const start = await call({ operation: 'begin', goal: 'Read Notes' })
  const observation = await call({ operation: 'observe', sessionId: start.sessionId })
  frame = { ...frame, width: 1000 }
  const result = await call({ operation: 'act', sessionId: start.sessionId, observationId: observation.observationId, action: { type: 'click', x: .5, y: .5 } })
  expect(result).toMatchObject({ success: false, retryable: true })
  expect(runControl.mock.calls.some(([action]) => action.type === 'click')).toBe(false)
  expect((await call({ operation: 'observe', sessionId: start.sessionId })).success).toBe(true)
  await call({ operation: 'cancel', sessionId: start.sessionId })
})
test('keyboard activity refreshes the observation and resumes the same session', async () => {
  let now = 100000, idle = 999
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now)
  const { call, deps } = harness({ runControl: jest.fn(async () => ({ success: true, pid: 1, app: 'Notes', keyIdleSeconds: idle })) })
  try {
    const start = await call({ operation: 'begin', goal: 'Read Notes' })
    const obs = await call({ operation: 'observe', sessionId: start.sessionId })
    now += 1000; idle = 0
    const action = { type: 'key', key: 'find' }
    expect(await call({ operation: 'act', sessionId: start.sessionId, observationId: obs.observationId, action })).toMatchObject({ success: false, retryable: true })
    expect(deps.runControl).not.toHaveBeenCalledWith(action)
    idle = 999
    const fresh = await call({ operation: 'observe', sessionId: start.sessionId })
    expect(fresh.evidence).toContain('NOT executed')
    expect((await call({ operation: 'act', sessionId: start.sessionId, observationId: fresh.observationId, action })).success).toBe(true)
    await call({ operation: 'cancel', sessionId: start.sessionId })
  } finally { clock.mockRestore() }
})
test('native sender gate rejects child frames and other origins', () => {
  const { event, window } = harness()
  expect(trustedMiraSender(event, window, 'https://app.talio.in')).toBe(true)
  expect(trustedMiraSender({ ...event, senderFrame: { url: event.senderFrame.url } }, window, 'https://app.talio.in')).toBe(false)
  event.senderFrame.url = 'https://evil.example/dashboard'
  expect(trustedMiraSender(event, window, 'https://app.talio.in')).toBe(false)
})
test('saved consent avoids repeated task dialogs and shows desktop pointer', async () => {
  const { call, deps } = harness()
  expect((await call({ operation: 'begin', goal: 'Open WhatsApp' })).success).toBe(true)
  expect(deps.dialog.showMessageBox).not.toHaveBeenCalled()
  expect(deps.pointer.show).toHaveBeenCalledTimes(1)
  await call({ operation: 'cancel' })
  expect(deps.pointer.hide).toHaveBeenCalled()
})
test('missing or revoked consent blocks desktop input', async () => {
  const { call, deps } = harness()
  deps.store.get.mockReturnValue(false)
  expect((await call({ operation: 'begin', goal: 'Open WhatsApp' })).success).toBe(false)
  expect(deps.pointer.show).not.toHaveBeenCalled()
  deps.store.get.mockReturnValue(true)
  const start = await call({ operation: 'begin', goal: 'Open WhatsApp' })
  deps.store.get.mockReturnValue(false)
  expect((await call({ operation: 'observe', sessionId: start.sessionId })).success).toBe(false)
  expect(deps.desktopCapturer.getSources).not.toHaveBeenCalled()
})
test('permission requests only open allowlisted OS settings and recheck actual status', async () => {
  const shell = { openExternal: jest.fn() }
  const permissions = createMiraPermissions({ platform: 'darwin', shell, systemPreferences: { getMediaAccessStatus: () => 'denied', isTrustedAccessibilityClient: () => false } })
  expect(permissions.status().microphone).toBe('denied')
  await permissions.request('microphone')
  expect(shell.openExternal).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
  expect((await permissions.request('arbitrary')).success).toBe(false)
})
test('desktop setup records explicit consent and allows revocation', async () => {
  let enabled = false
  const store = { get: () => enabled, set: jest.fn(() => { enabled = true }), delete: jest.fn(() => { enabled = false }) }
  const dialog = { showMessageBox: jest.fn(async () => ({ response: 0 })) }
  const permissions = createMiraPermissions({ platform: 'darwin', store, dialog, shell: {}, systemPreferences: { getMediaAccessStatus: () => 'granted', isTrustedAccessibilityClient: () => true } })
  await permissions.request('desktopControl')
  expect(permissions.status().desktopControl).toBe('denied')
  dialog.showMessageBox.mockResolvedValue({ response: 1 })
  await permissions.request('desktopControl')
  expect(permissions.status().desktopControl).toBe('granted')
  await permissions.request('revokeDesktopControl')
  expect(permissions.status().desktopControl).toBe('denied')
})
