import { executeMiraComputerTask } from '@/lib/miraComputerClient'
afterEach(() => { delete window.electronAPI })
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
  expect(JSON.parse(fetch.mock.calls[0][1].body).goal).toBe('Open Notes')
})
test('abort during native consent never executes a desktop input', async () => {
  const controller = new AbortController()
  window.electronAPI = { computerTask: jest.fn(async input => { if (input.operation === 'begin') controller.abort(); return { success: true, sessionId: 's' } }) }
  await expect(executeMiraComputerTask('Open Notes', { token: 't', signal: controller.signal })).rejects.toThrow()
  expect(window.electronAPI.computerTask.mock.calls.map(([input]) => input.operation)).toEqual(['begin', 'cancel'])
})
