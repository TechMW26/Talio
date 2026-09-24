import { executeMiraComputerTask } from '@/lib/miraComputerClient'
afterEach(() => { delete window.electronAPI })
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
