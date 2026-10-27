import { executeMiraComputerTask, fetchMiraDesktopPlan, miraDesktopExecutionLedger } from '@/lib/miraComputerClient'
afterEach(() => { delete window.electronAPI })
test('large editing batches cannot overflow the recovery ledger request budget', () => {
  const history = Array(24).fill({ action: { type: 'batch', actions: Array(4).fill({ type: 'type', text: 'x'.repeat(2000) }) }, result: 'x'.repeat(3000) })
  const ledger = miraDesktopExecutionLedger(history)
  expect(ledger.length).toBeGreaterThan(0)
  expect(ledger.length).toBeLessThanOrEqual(8)
  expect(JSON.stringify(ledger).length).toBeLessThanOrEqual(14000)
  expect(history[0].action.actions[0].text).toHaveLength(2000)
})
test('forwards delivered inputs to the model after native history compaction', async () => {
  const originalFetch = global.fetch
  let observations = 0
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, text: 'agent.done("Verified")' }) }))
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local' }
    if (input.operation === 'observe') return { success: true, observationId: `o${++observations}`, app: 'Calculator', image: `screen${observations}` }
    if (input.operation === 'plan') return observations === 1 ? { success: true, action: { type: 'key', key: 'enter' } } : { success: true, kind: 'model_request', messages: [] }
    if (input.operation === 'model_response') return { success: true, done: true, message: 'Verified' }
    if (input.operation === 'act') return { success: true, message: 'Input delivered, not yet verified.' }
    return { success: true }
  }) }
  try {
    expect((await executeMiraComputerTask('Calculate the correction', { token: 't' })).success).toBe(true)
    expect(JSON.parse(fetch.mock.calls[0][1].body).executionHistory).toEqual([{ action: { type: 'key', key: 'enter' }, result: 'Input delivered, not yet verified.' }])
  } finally { global.fetch = originalFetch }
})
test('a three-input navigation uses one observation then verifies with the next screenshot', async () => {
  let observations = 0
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local', capabilities: { actionBatch: true, navigateCurrentTab: true } }
    if (input.operation === 'observe') return { success: true, observationId: `o${++observations}`, app: 'Chrome', image: `screen${observations}` }
    if (input.operation === 'plan') return observations === 1 ? { success: true, action: { type: 'navigate', url: 'https://example.com' } } : { success: true, done: true, message: 'Page verified.' }
    if (input.operation === 'act') return { success: true, completedActions: 3 }
    return { success: true }
  }) }
  expect(await executeMiraComputerTask('Open example.com', { token: 't' })).toMatchObject({ success: true, message: 'Page verified.' })
  expect(window.electronAPI.computerTask.mock.calls.map(([i]) => i.operation)).toEqual(['begin', 'observe', 'plan', 'act', 'observe', 'plan', 'cancel'])
  expect(observations).toBe(2)
})

test('partial batch failure inspects again but never replays the sequence', async () => {
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local' }
    if (input.operation === 'observe') return { success: true, observationId: 'o', app: 'Chrome' }
    if (input.operation === 'plan') return { success: true, action: { type: 'navigate', url: 'https://example.com' } }
    if (input.operation === 'act') return { success: false, completedActions: 1, message: 'Window changed.' }
    return { success: true }
  }) }
  expect(await executeMiraComputerTask('Open example.com', { token: 't' })).toMatchObject({ success: false, uncertain: true })
  expect(window.electronAPI.computerTask.mock.calls.map(([i]) => i.operation)).toEqual(['begin', 'observe', 'plan', 'act', 'observe', 'plan', 'cancel'])
})
test('a rejected model request rebuilds the planner and continues from a fresh observation', async () => {
  const originalFetch = global.fetch
  let plans = 0
  global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ success: false }) }))
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local' }
    if (input.operation === 'observe') return { success: true, observationId: 'o' }
    if (input.operation === 'plan') return ++plans === 1 ? { success: true, kind: 'model_request', messages: [] } : { success: true, done: true, message: 'Verified.' }
    return { success: true }
  }) }
  try {
    expect(await executeMiraComputerTask('Read Notes', { token: 't' })).toMatchObject({ success: true, message: 'Verified.' })
    expect(window.electronAPI.computerTask).toHaveBeenCalledWith({ operation: 'recover', sessionId: 's', resetPlanner: true })
    expect(plans).toBe(2)
  } finally { global.fetch = originalFetch }
})
test('new native FAST route completes without screenshots or model calls', async () => {
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', decision: { route: 'FAST' } }
    if (input.operation === 'fast') return { success: true, done: true, message: 'WhatsApp is open.' }
    return { success: true }
  }) }
  expect(await executeMiraComputerTask('Open WhatsApp', { token: 't' })).toMatchObject({ success: true, done: true })
  expect(window.electronAPI.computerTask.mock.calls.map(([i]) => i.operation)).toEqual(['begin', 'fast', 'cancel'])
})
test('compound tasks activate first then hand the current screen to Agent S', async () => {
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local', decision: { route: 'FAST' } }
    if (input.operation === 'fast') return { success: true, done: false }
    if (input.operation === 'observe') return { success: true, observationId: 'o', app: 'WhatsApp' }
    if (input.operation === 'plan') return { success: true, question: 'Which Mansi do you mean?' }
    return { success: true }
  }) }
  expect((await executeMiraComputerTask('Open WhatsApp and find Mansi', { token: 't' })).message).toBe('Which Mansi do you mean?')
  expect(window.electronAPI.computerTask.mock.calls.map(([i]) => i.operation)).toEqual(['begin', 'fast', 'observe', 'plan', 'cancel'])
})
test('repeated invalid plans are bounded and never emit native input', async () => {
  jest.useFakeTimers()
  try {
    window.electronAPI = { computerTask: jest.fn(async input => {
      if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local' }
      if (input.operation === 'observe') return { success: true, observationId: 'o' }
      if (input.operation === 'plan') return { success: true, retryable: true }
      return { success: true }
    }) }
    const pending = executeMiraComputerTask('Read the note', { token: 't' })
    await jest.runAllTimersAsync()
    expect(await pending).toMatchObject({ success: false, message: expect.stringContaining('several fresh observations') })
    expect(window.electronAPI.computerTask.mock.calls.filter(([i]) => i.operation === 'plan')).toHaveLength(5)
    expect(window.electronAPI.computerTask.mock.calls.some(([i]) => i.operation === 'act')).toBe(false)
  } finally { jest.useRealTimers() }
})
test('planner fallback automatically re-observes and resumes without asking the user', async () => {
  let plans = 0
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local' }
    if (input.operation === 'observe') return { success: true, observationId: 'o', app: 'Notes' }
    if (input.operation === 'plan') return ++plans === 1
      ? { success: true, retryable: true, retryAfterMs: 200 }
      : { success: true, done: true, message: 'Task verified.' }
    return { success: true }
  }) }
  expect(await executeMiraComputerTask('Read the note', { token: 't' })).toMatchObject({ success: true, message: 'Task verified.' })
  expect(plans).toBe(2)
  expect(window.electronAPI.computerTask.mock.calls.some(([i]) => i.operation === 'act')).toBe(false)
})
test('voice override aborts recovery without another observation or input', async () => {
  const controller = new AbortController()
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local' }
    if (input.operation === 'observe') return { success: true, observationId: 'o' }
    if (input.operation === 'plan') { controller.abort(); return { success: true, retryable: true } }
    return { success: true }
  }) }
  await expect(executeMiraComputerTask('Read the note', { token: 't', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(window.electronAPI.computerTask.mock.calls.map(([i]) => i.operation)).toEqual(['begin', 'observe', 'plan', 'cancel'])
})
test('retries transient model failures with a bounded backoff', async () => {
  jest.useFakeTimers()
  try {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue({ ok: true })
    const pending = fetchMiraDesktopPlan('/model', {})
    await jest.runAllTimersAsync()
    expect((await pending).ok).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  } finally { jest.useRealTimers() }
})
test('does not retry a failed desktop mutation even if the model could retry', async () => {
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local' }
    if (input.operation === 'observe') return { success: true, observationId: 'o', app: 'Notes' }
    if (input.operation === 'plan') return { success: true, action: { type: 'key', key: 'enter' } }
    if (input.operation === 'act') return { success: false, message: 'Input outcome uncertain' }
    return { success: true }
  }) }
  expect((await executeMiraComputerTask('Submit the note', { token: 't' })).success).toBe(false)
  expect(window.electronAPI.computerTask.mock.calls.filter(([i]) => i.operation === 'act')).toHaveLength(1)
})
test('already-aborted requests cannot begin a desktop session', async () => {
  window.electronAPI = { computerTask: jest.fn() }
  const controller = new AbortController()
  controller.abort()
  await expect(executeMiraComputerTask('Open WhatsApp', { token: 't', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(window.electronAPI.computerTask).not.toHaveBeenCalled()
})
test('named app opening bypasses a vision call but completion still requires observation', async () => {
  let observations = 0
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local' }
    if (input.operation === 'observe') return { success: true, observationId: `o${observations}`, app: observations++ ? 'WhatsApp' : 'Finder' }
    if (input.operation === 'plan') return { success: true, done: true, message: 'WhatsApp is open.' }
    return { success: true }
  }) }
  expect(await executeMiraComputerTask('Open WhatsApp', { token: 't' })).toMatchObject({ success: true })
  const calls = window.electronAPI.computerTask.mock.calls.map(([input]) => input)
  expect(calls.map(c => c.operation)).toEqual(['begin', 'observe', 'act', 'observe', 'cancel'])
  expect(calls[2].action).toEqual({ type: 'open_app', name: 'WhatsApp' })
})
test('local Agent S exchanges model messages without sending the task to the legacy planner', async () => {
  const calls = []
  window.electronAPI = { computerTask: jest.fn(async input => {
    calls.push(input.operation)
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local' }
    if (input.operation === 'observe') return { success: true, observationId: 'o' }
    if (input.operation === 'plan') return { success: true, kind: 'model_request', messages: [{ role: 'user', content: [] }] }
    if (input.operation === 'model_response') return { success: true, kind: 'result', done: true, message: 'WhatsApp is open.' }
    return { success: true }
  }) }
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, text: 'agent.done("WhatsApp is open.")' }) }))
  expect(await executeMiraComputerTask('Open WhatsApp', { token: 't' })).toMatchObject({ success: true, message: 'WhatsApp is open.' })
  expect(calls).toEqual(['begin', 'observe', 'plan', 'model_response', 'cancel'])
  expect(fetch.mock.calls[0][0]).toBe('/api/ai/mira-agent-s')
})
test('does not claim desktop capability in browsers', async () => {
  expect((await executeMiraComputerTask('Open Notes', { token: 't' })).success).toBe(false)
})
test('completion comes from a fresh observation and always ends the native session', async () => {
  const calls = []
  window.electronAPI = { computerTask: jest.fn(async input => {
    calls.push(input.operation)
    return input.operation === 'begin' ? { success: true, sessionId: 's' } : { success: true, observationId: 'o', image: 'aW1hZ2U=', app: 'Notes' }
  }) }
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, done: true, message: 'Notes is open.' }) }))
  expect(await executeMiraComputerTask('Open Notes', { token: 't' })).toMatchObject({ success: true, message: 'Notes is open.' })
  expect(calls).toEqual(['begin', 'observe', 'cancel'])
  expect(fetch).not.toHaveBeenCalled()
})
test('abort during native consent never executes a desktop input', async () => {
  const controller = new AbortController()
  window.electronAPI = { computerTask: jest.fn(async input => { if (input.operation === 'begin') controller.abort(); return { success: true, sessionId: 's' } }) }
  await expect(executeMiraComputerTask('Open Notes', { token: 't', signal: controller.signal })).rejects.toThrow()
  expect(window.electronAPI.computerTask.mock.calls.map(([input]) => input.operation)).toEqual(['begin', 'cancel'])
})

test('partial input uncertainty uses a fresh observation to repair only unfinished work', async () => {
  let observations = 0, inputs = 0
  const batch = { type: 'batch', actions: [{ type: 'key', key: 'find' }, { type: 'type', text: 'quarterly revenue' }] }
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local', capabilities: { completionCheck: true } }
    if (input.operation === 'observe') return { success: true, observationId: `o${++observations}`, image: `screen-${observations}`, app: 'Chrome' }
    if (input.operation === 'plan') return observations === 1 ? { success: true, action: batch }
      : observations === 2 ? { success: true, action: { type: 'key', key: 'escape' } } : { success: true, done: true, message: 'Result verified.' }
    if (input.operation === 'act') return ++inputs === 1 ? { success: false, completedActions: 1, uncertain: true, message: 'Typing delivery uncertain.' } : { success: true }
    if (input.operation === 'verify') return { success: true, observationVerified: true }
    return { success: true }
  }) }
  const result = await executeMiraComputerTask('Find quarterly revenue on this page', { token: 't' })
  expect(result).toMatchObject({ success: true, verified: true, orchestration: { observations: 3, recoveries: 1, recentFailures: [{ uncertain: true }] } })
  const calls = window.electronAPI.computerTask.mock.calls.map(([input]) => input)
  expect(calls.filter(input => input.operation === 'act')).toEqual([
    { operation: 'act', sessionId: 's', observationId: 'o1', action: batch },
    { operation: 'act', sessionId: 's', observationId: 'o2', action: { type: 'key', key: 'escape' } },
  ])
  expect(calls.at(-2)).toEqual({ operation: 'verify', sessionId: 's', observationId: 'o3' })
})

test('reordering a partially delivered action does not bypass non-replay protection', async () => {
  let observations = 0
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local' }
    if (input.operation === 'observe') return { success: true, observationId: `o${++observations}`, image: `screen-${observations}` }
    if (input.operation === 'plan') return { success: true, action: observations === 1 ? { type: 'navigate', url: 'https://example.com' } : { url: 'https://example.com', type: 'navigate' } }
    if (input.operation === 'act') return { success: false, completedActions: 1, uncertain: true }
    return { success: true }
  }) }
  expect(await executeMiraComputerTask('Open example.com', { token: 't' })).toMatchObject({ success: false, uncertain: true })
  expect(observations).toBe(2)
  expect(window.electronAPI.computerTask.mock.calls.filter(([input]) => input.operation === 'act')).toHaveLength(1)
})

test('repackaging an uncertain batch input as a single action cannot replay it', async () => {
  let observations = 0
  const type = { type: 'type', text: 'quarterly revenue' }
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local' }
    if (input.operation === 'observe') return { success: true, observationId: `o${++observations}`, image: `screen-${observations}` }
    if (input.operation === 'plan') return { success: true, action: observations === 1 ? { type: 'batch', actions: [{ type: 'key', key: 'find' }, type] } : type }
    if (input.operation === 'act') return { success: false, completedActions: 1, uncertain: true }
    return { success: true }
  }) }
  expect(await executeMiraComputerTask('Find quarterly revenue', { token: 't' })).toMatchObject({ success: false, uncertain: true })
  expect(observations).toBe(2)
  expect(window.electronAPI.computerTask.mock.calls.filter(([input]) => input.operation === 'act')).toHaveLength(1)
})

test('no-progress recovery suppresses the repeated input and permits a different grounded method', async () => {
  let observations = 0
  const click = { type: 'click', x: .2, y: .3 }
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local' }
    if (input.operation === 'observe') return { success: true, observationId: `o${++observations}`, image: 'unchanged-screen' }
    if (input.operation === 'plan') return observations <= 2 ? { success: true, action: click }
      : observations === 3 ? { success: true, action: { type: 'key', key: 'tab' } } : { success: true, done: true, message: 'Focus verified.' }
    return { success: true }
  }) }
  expect(await executeMiraComputerTask('Focus the search field', { token: 't' })).toMatchObject({ success: true, orchestration: { recoveries: 1 } })
  const calls = window.electronAPI.computerTask.mock.calls.map(([input]) => input)
  expect(calls.filter(input => input.operation === 'act').map(input => input.action)).toEqual([click, { type: 'key', key: 'tab' }])
  expect(calls.some(input => input.operation === 'recover')).toBe(true)
})

test('different observed screens with the same prefix do not falsely block an identical action', async () => {
  let observations = 0
  const click = { type: 'click', x: .2, y: .3 }
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local' }
    if (input.operation === 'observe') return { success: true, observationId: `o${++observations}`, image: `screen-${observations}` }
    if (input.operation === 'plan') return observations < 3 ? { success: true, action: click } : { success: true, done: true, message: 'Result verified.' }
    return { success: true }
  }) }
  expect((await executeMiraComputerTask('Select the next two results', { token: 't' })).success).toBe(true)
  expect(window.electronAPI.computerTask.mock.calls.filter(([input]) => input.operation === 'act')).toHaveLength(2)
})

test.each(['agent-s-local', 'legacy'])('%s completion is re-observed when the final native identity check changes', async planner => {
  const savedFetch = global.fetch
  let observations = 0, checks = 0
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, done: true, message: 'Calculation verified.' }) }))
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner, capabilities: { completionCheck: true } }
    if (input.operation === 'observe') return { success: true, observationId: `o${++observations}`, image: `screen-${observations}` }
    if (input.operation === 'plan') return { success: true, done: true, message: 'Calculation verified.' }
    if (input.operation === 'verify') return ++checks === 1 ? { success: false, retryable: true, message: 'Foreground changed.' } : { success: true, observationVerified: true }
    return { success: true }
  }) }
  try {
    expect(await executeMiraComputerTask('Check the calculation result', { token: 't' })).toMatchObject({ success: true, verified: true })
    const calls = window.electronAPI.computerTask.mock.calls.map(([input]) => input)
    expect(calls.filter(input => input.operation === 'verify').map(input => input.observationId)).toEqual(['o1', 'o2'])
    expect(calls.some(input => input.operation === 'act')).toBe(false)
    expect(calls.at(-1)).toEqual({ operation: 'cancel', sessionId: 's' })
  } finally { global.fetch = savedFetch }
})

test('an unqualified success response is not evidence of native completion verification', async () => {
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local', capabilities: { completionCheck: true } }
    if (input.operation === 'observe') return { success: true, observationId: 'o', app: 'Notes' }
    if (input.operation === 'plan') return { success: true, done: true, message: 'Done.' }
    return { success: true }
  }) }
  expect(await executeMiraComputerTask('Open Notes', { token: 't' })).toMatchObject({ success: false, message: expect.stringContaining('could not be verified') })
  expect(window.electronAPI.computerTask).toHaveBeenCalledWith({ operation: 'verify', sessionId: 's', observationId: 'o' })
})

test.each(['observe', 'plan', 'verify', 'act'])('cancellation during %s cannot return success or send subsequent input', async phase => {
  const controller = new AbortController()
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local', capabilities: { completionCheck: true } }
    if (input.operation === phase) controller.abort()
    if (input.operation === 'observe') return { success: true, observationId: 'o', app: 'Calculator' }
    if (input.operation === 'plan') return phase === 'act' ? { success: true, action: { type: 'key', key: 'enter' } } : { success: true, done: true, message: 'Done.' }
    return { success: true, observationVerified: true }
  }) }
  await expect(executeMiraComputerTask('Check the calculation result', { token: 't', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  const operations = window.electronAPI.computerTask.mock.calls.map(([input]) => input.operation)
  expect(operations.filter(operation => operation === 'cancel')).toHaveLength(1)
  expect(operations.at(-1)).toBe('cancel')
  expect(operations.filter(operation => operation === 'act')).toHaveLength(phase === 'act' ? 1 : 0)
})
