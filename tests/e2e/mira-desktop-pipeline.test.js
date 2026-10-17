// Integrated simulated desktop: real client, native session guards, signed-plan
// service and hybrid selector. Only OS I/O and provider responses are fixtures.
import { executeMiraComputerTask } from '@/lib/miraComputerClient'
import { requestHybridDesktop } from '@/lib/ai/miraHybridDesktop'
const { createMiraComputer } = require('../../desktop-app/src/miraComputer')

const response = body => ({ ok: true, json: async () => body })
const envNames = ['TYPESAFE_API_KEY', 'DEEPSEEK_API_KEY', 'JWT_SECRET', 'MIRA_JEV_ENABLED']
let savedEnv, savedWindow, savedFetch
beforeEach(() => {
  savedEnv = Object.fromEntries(envNames.map(key => [key, process.env[key]]))
  savedWindow = global.window; savedFetch = global.fetch
  for (const key of envNames) process.env[key] = key === 'MIRA_JEV_ENABLED' ? 'true' : 'fixture-secret'
})
afterEach(() => {
  for (const key of envNames) savedEnv[key] === undefined ? delete process.env[key] : process.env[key] = savedEnv[key]
  global.window = savedWindow; global.fetch = savedFetch
})

function fixture({ rejectOnce = false, uncertain = false, providerDown = false, noEffect = false } = {}) {
  let app = 'Talio', mode = 'Basic', openedMenu = false, revision = 0, rejected = false
  const calculation = '42'
  const operations = [], inputs = [], snapshots = [], diagnostics = []
  const contents = { mainFrame: { url: 'https://app.talio.in/dashboard' } }
  const event = { sender: contents, senderFrame: contents.mainFrame }
  const nativeWindow = { webContents: contents, isDestroyed: () => false }
  const status = () => ({ success: true, pid: 1, app, keyIdleSeconds: 999 })
  const agentS = {
    begin: jest.fn(async () => ({ kind: 'ready' })), stop: jest.fn(),
    predict: jest.fn(async () => mode === 'Scientific'
      ? { kind: 'result', done: true, message: 'Scientific mode verified; calculation unchanged.' }
      : { kind: 'result', question: 'The requested mode is not yet verified.' }),
  }
  const native = createMiraComputer({
    platform: 'darwin', packaged: false, agentS,
    store: { get: () => true },
    systemPreferences: { getMediaAccessStatus: () => 'granted', isTrustedAccessibilityClient: () => true },
    globalShortcut: { register: () => true, unregister: () => {} },
    screen: { getCursorScreenPoint: () => ({ x: 1, y: 1 }), getDisplayNearestPoint: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } }) },
    desktopCapturer: { getSources: async () => {
      snapshots.push({ mode, calculation })
      return [{ display_id: '1', thumbnail: { isEmpty: () => false, toJPEG: () => Buffer.from(mode) } }]
    } },
    runControl: async action => {
      if (action.type === 'open_app') { app = 'Calculator'; return { success: true } }
      if (action.type === 'ui_elements') {
        revision++
        return { success: true, pid: 1, elements: [{ ref: `ref-${revision}`, role: openedMenu ? 'AXMenuItem' : 'AXMenuBarItem', label: openedMenu ? 'Scientific' : 'View', frame: { x: 100, y: 100, width: 100, height: 40 } }] }
      }
      if (action.type === 'ax_action') {
        inputs.push(action)
        expect(action.ref).toBe(`ref-${revision}`)
        if (uncertain) return { success: false, notExecuted: false }
        if (rejectOnce && !rejected) { rejected = true; return { success: false, notExecuted: true } }
        if (!noEffect) { if (action.label === 'View') openedMenu = true; else mode = 'Scientific' }
        return { success: true, message: 'Control invoked; verify.' }
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
    if (url === '/api/ai/mira-desktop-plan') return response(await requestHybridDesktop(body, 'tenant:user', options.signal))
    if (url === 'https://api.deepseek.com/chat/completions') {
      if (providerDown) return { ok: false, status: 503 }
      expect(JSON.parse(body.messages[1].content).goal).toContain('Do not change')
      return response({ choices: [{ message: { content: JSON.stringify({ steps: [
        { operation: 'click', app: 'Calculator', target: 'View' },
        { operation: 'click', app: 'Calculator', target: 'Scientific' },
      ] }) } }] })
    }
    // Exact matches must not cost a Jev request. Unknown targets may not be clicked.
    if (url === 'https://api.typesafe.ai/v1/systemone') return response({ answers: { target: { type: 'choice', choice: 'NONE', confidence: 1, probabilities: { NONE: 1 } }, unique: { type: 'noul', noul: 0 } } })
    throw new Error('Unexpected network request')
  })
  return { operations, inputs, snapshots, diagnostics, agentS,
    run: () => executeMiraComputerTask('Open Calculator and switch to Scientific mode. Do not change the current calculation.', { token: 'fixture', onDiagnostic: x => diagnostics.push(x) }) }
}

test('launch → two fresh native selections → independent verification, with no typing or pixel clicks', async () => {
  const f = fixture()
  expect(await f.run()).toMatchObject({ success: true })
  expect(f.inputs.map(input => input.label)).toEqual(['View', 'Scientific'])
  expect(f.snapshots).toEqual([{ mode: 'Scientific', calculation: '42' }])
  expect(f.operations).toEqual(['begin', 'fast', 'observe', 'act', 'observe', 'act', 'observe', 'plan', 'cancel'])
  expect(f.diagnostics.some(x => x.decision === 'exact_target')).toBe(true)
  expect(f.agentS.predict).toHaveBeenCalledTimes(1)
})
test('proven not-executed input retries from a new observation, retaining the plan', async () => {
  const f = fixture({ rejectOnce: true })
  expect(await f.run()).toMatchObject({ success: true })
  expect(f.inputs.map(input => input.ref)).toEqual(['ref-1', 'ref-2', 'ref-3'])
  expect(fetch.mock.calls.filter(([url]) => url.includes('deepseek.com'))).toHaveLength(1)
})
test('uncertain native effect is never replayed or called complete', async () => {
  const f = fixture({ uncertain: true })
  expect(await f.run()).toMatchObject({ success: false })
  expect(f.inputs).toHaveLength(1)
  expect(f.operations.at(-1)).toBe('cancel')
})
test('provider failure returns to the existing visual executor without input', async () => {
  const f = fixture({ providerDown: true })
  expect(await f.run()).toMatchObject({ success: false, message: 'The requested mode is not yet verified.' })
  expect(f.inputs).toHaveLength(0)
  expect(f.agentS.predict).toHaveBeenCalledTimes(1)
})
test('a successful native press without the desired state is not completion', async () => {
  const f = fixture({ noEffect: true })
  expect(await f.run()).toMatchObject({ success: false })
  expect(f.inputs).toHaveLength(1)
  expect(f.snapshots).toEqual([{ mode: 'Basic', calculation: '42' }])
})
