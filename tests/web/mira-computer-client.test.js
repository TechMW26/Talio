import { executeMiraComputerTask, fetchMiraDesktopPlan } from '@/lib/miraComputerClient'
afterEach(() => { delete window.electronAPI })
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
    expect(window.electronAPI.computerTask.mock.calls.filter(([i]) => i.operation === 'plan')).toHaveLength(7)
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
  expect(await executeMiraComputerTask('Read the note', { token: 't' })).toEqual({ success: true, message: 'Task verified.' })
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
  expect(await executeMiraComputerTask('Open WhatsApp', { token: 't' })).toEqual({ success: true, message: 'WhatsApp is open.' })
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
  expect(await executeMiraComputerTask('Open Notes', { token: 't' })).toEqual({ success: true, message: 'Notes is open.' })
  expect(calls).toEqual(['begin', 'observe', 'cancel'])
  expect(fetch).not.toHaveBeenCalled()
})
test('abort during native consent never executes a desktop input', async () => {
  const controller = new AbortController()
  window.electronAPI = { computerTask: jest.fn(async input => { if (input.operation === 'begin') controller.abort(); return { success: true, sessionId: 's' } }) }
  await expect(executeMiraComputerTask('Open Notes', { token: 't', signal: controller.signal })).rejects.toThrow()
  expect(window.electronAPI.computerTask.mock.calls.map(([input]) => input.operation)).toEqual(['begin', 'cancel'])
})
