// Real restored client + native session executor + authenticated model service.
// OS I/O and model responses are fixtures; this never controls a real desktop.
import { executeMiraComputerTask } from '@/lib/miraComputerClient'
import { requestAgentSModel } from '@/lib/ai/agentSProxy'
const { createMiraComputer } = require('../../desktop-app/src/miraComputer')
let savedWindow, savedFetch, savedKey
beforeEach(() => {
  savedWindow = global.window; savedFetch = global.fetch; savedKey = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = 'fixture'
})
afterEach(() => {
  global.window = savedWindow; global.fetch = savedFetch
  if (savedKey === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = savedKey
})
function fixture({ uncertain = false, noEffect = false, rejectPlanOnce = false } = {}) {
  let app = 'Talio', stage = 0, plans = 0
  const operations = [], inputs = [], snapshots = []
  const contents = { mainFrame: { url: 'https://app.talio.in/dashboard' } }
  const event = { sender: contents, senderFrame: contents.mainFrame }
  const nativeWindow = { webContents: contents, isDestroyed: () => false }
  const status = () => ({ success: true, pid: 1, app, keyIdleSeconds: 999 })
  const agentS = {
    begin: jest.fn(async () => ({ kind: 'ready' })), stop: jest.fn(),
    predict: jest.fn(async observation => {
      expect(observation.image).toBeTruthy()
      if (rejectPlanOnce && plans++ === 0) throw new Error('Transient planner error')
      return { kind: 'model_request', messages: [{ role: 'user', content: [
        { type: 'text', text: 'Switch Calculator view. Do not change calculation. Stage ' + stage },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + observation.image } },
      ] }] }
    }),
    respond: jest.fn(async text => ({ kind: 'result', ...JSON.parse(text) })),
  }
  const native = createMiraComputer({
    platform: 'darwin', packaged: false, agentS, store: { get: () => true },
    systemPreferences: { getMediaAccessStatus: () => 'granted', isTrustedAccessibilityClient: () => true },
    globalShortcut: { register: () => true, unregister: () => {} },
    screen: { getCursorScreenPoint: () => ({ x: 1, y: 1 }), getDisplayNearestPoint: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } }) },
    desktopCapturer: { getSources: async () => {
      snapshots.push(stage)
      return [{ display_id: '1', thumbnail: { isEmpty: () => false, toJPEG: () => Buffer.from('screen-' + stage) } }]
    } },
    runControl: async action => {
      if (action.type === 'open_app') { app = 'Calculator'; return { success: true } }
      if (action.type === 'ui_elements') return { success: true, pid: 1, elements: [] }
      if (action.type === 'click') {
        inputs.push(action)
        if (uncertain) return { success: false, notExecuted: false }
        if (!noEffect) stage++
        return { success: true }
      }
      expect(['status', 'prepare_window', 'restore_window']).toContain(action.type)
      return status()
    },
  })
  global.window = { dispatchEvent() {}, electronAPI: { computerTask: input => {
    operations.push(input.operation)
    return native(event, nativeWindow, 'https://app.talio.in', input)
  } } }
  global.fetch = jest.fn(async (url, options) => {
    const body = JSON.parse(options.body)
    if (url === '/api/ai/mira-agent-s') return { ok: true, json: async () => ({ success: true, text: await requestAgentSModel(body.messages) }) }
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(body.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'))).toBe(true)
    const action = stage >= 2 ? { done: true, message: 'Scientific mode verified.' }
      : { action: { type: 'click', x: .2, y: stage === 0 ? .2 : .3 } }
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(action) } }] }) }
  })
  return { inputs, snapshots, operations, agentS,
    run: () => executeMiraComputerTask('Open Calculator and switch to Scientific mode.', { token: 'fixture' }) }
}
test('restored visual flow observes every step, executes screen inputs and verifies completion without Jev', async () => {
  const f = fixture()
  expect(await f.run()).toMatchObject({ success: true, verified: true, message: 'Scientific mode verified.', orchestration: { observations: 3, executedInputs: 2, recoveries: 0, recentFailures: [] } })
  expect(f.inputs).toHaveLength(2)
  expect(f.snapshots).toEqual([0, 1, 2])
  expect(f.agentS.predict).toHaveBeenCalledTimes(3)
  expect(f.operations.filter(operation => operation === 'verify')).toHaveLength(1)
  expect(f.operations.at(-1)).toBe('cancel')
  expect(fetch.mock.calls.every(([url]) => ['/api/ai/mira-agent-s', 'https://api.deepseek.com/chat/completions'].includes(url))).toBe(true)
})
test('failed planning restarts from a fresh screenshot before any input', async () => {
  const f = fixture({ rejectPlanOnce: true })
  expect((await f.run()).success).toBe(true)
  expect(f.snapshots).toEqual([0, 0, 1, 2])
  expect(f.inputs).toHaveLength(2)
})
test('uncertain input is not blindly replayed or claimed complete', async () => {
  const f = fixture({ uncertain: true })
  expect((await f.run()).success).toBe(false)
  expect(f.inputs).toHaveLength(1)
  expect(f.operations.at(-1)).toBe('cancel')
})
test('unchanged screenshots stop repeated actions without false completion', async () => {
  const f = fixture({ noEffect: true })
  expect((await f.run()).success).toBe(false)
  expect(f.inputs).toHaveLength(1)
  expect(f.operations.at(-1)).toBe('cancel')
})
