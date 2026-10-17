import { createHybridDesktopPlan } from '@/lib/miraHybridDesktopClient'
import { executeMiraComputerTask, fetchMiraDesktopPlan } from '@/lib/miraComputerClient'
const observation = { success: true, observationId: 'o', app: 'Notes', fingerprint: 'state', targets: [{ ref: 'a', role: 'AXSearchField', label: 'Search' }] }
const reply = body => ({ ok: true, json: async () => body })
afterEach(() => { delete window.electronAPI; jest.useRealTimers() })
test('caches the plan only for this task, with sequential Jev selections', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce(reply({ success: true, plan: 'signed', count: 2 })).mockResolvedValue(reply({ success: true, action: { type: 'semantic', operation: 'click', ref: 'a' } }))
  const plan = createHybridDesktopPlan('Find a note', 'token')
  await plan.next(observation); plan.advance(); await plan.next(observation); plan.advance()
  expect(fetch.mock.calls.map(([, opts]) => JSON.parse(opts.body).operation)).toEqual(['plan', 'select', 'select'])
  expect(plan.enabled).toBe(false)
  expect(await plan.next(observation)).toBeNull(); expect(fetch).toHaveBeenCalledTimes(3)
})
test('timeout/unavailable provider disables Jev for the task rather than retrying each step', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network'))
  const plan = createHybridDesktopPlan('Find note', 'token')
  expect(await plan.next(observation)).toBeNull(); expect(await plan.next(observation)).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(1)
})
test('first selection piggybacks on the plan and diagnostics contain no task text', async () => {
  const diagnostic = jest.fn()
  global.fetch = jest.fn().mockResolvedValue(reply({ success: true, plan: 'signed', count: 1, selection: { success: true, decision: 'exact_target', action: { type: 'semantic', ref: 'a' } } }))
  const plan = createHybridDesktopPlan('Private task text', 'secret-token', undefined, diagnostic)
  expect(await plan.next(observation)).toMatchObject({ action: { ref: 'a' } })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(JSON.parse(fetch.mock.calls[0][1].body).selectInitial).toBe(true)
  expect(diagnostic).toHaveBeenCalledWith({ stage: 'plan', ms: expect.any(Number), decision: 'exact_target', reason: undefined })
  expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/Private|secret-token|signed/)
})
test('a target miss refreshes once without replanning or replaying previous input', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(reply({ success: true, plan: 'signed', count: 2, selection: { fallback: true, reason: 'no_controls' } }))
    .mockResolvedValueOnce(reply({ fallback: true, reason: 'uncertain_target' }))
  const plan = createHybridDesktopPlan('Open view', 't')
  expect(await plan.next(observation)).toMatchObject({ retryable: true })
  expect(plan.enabled).toBe(true)
  expect(await plan.next({ ...observation, observationId: 'fresh' })).toBeNull()
  expect(plan.enabled).toBe(false)
  expect(fetch.mock.calls.map(([, opts]) => JSON.parse(opts.body).operation)).toEqual(['plan', 'select'])
})
test('known not-executed input gets one fresh selection, aborts are never swallowed', async () => {
  const controller = new AbortController()
  global.fetch = jest.fn().mockResolvedValue(reply({ success: true, plan: 'signed', count: 2, selection: { success: true, action: { type: 'semantic', ref: 'a' } } }))
  const plan = createHybridDesktopPlan('Open view', 't', controller.signal)
  await plan.next(observation)
  plan.rejected(); expect(plan.enabled).toBe(true)
  plan.rejected(); expect(plan.enabled).toBe(false)
  const aborted = createHybridDesktopPlan('Open view', 't', controller.signal)
  controller.abort()
  await expect(aborted.next(observation)).rejects.toThrow()
  expect(fetch).toHaveBeenCalledTimes(1)
})
test('runs semantic step then independently verifies through a fresh visual observation', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce(reply({ success: true, plan: 'signed', count: 1 })).mockResolvedValue(reply({ success: true, action: { type: 'semantic', operation: 'fill', ref: 'a', text: 'hello' } }))
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local', capabilities: { semanticControl: true } }
    if (input.operation === 'observe') return { ...observation, ...(input.semantic ? {} : { image: 'fresh' }) }
    if (input.operation === 'act') return { success: true, verified: true }
    if (input.operation === 'plan') return { success: true, done: true, message: 'Search results verified.' }
    return { success: true }
  }) }
  expect(await executeMiraComputerTask('Search Notes for hello', { token: 't' })).toEqual({ success: true, message: 'Search results verified.' })
  expect(window.electronAPI.computerTask.mock.calls.map(([x]) => x.operation)).toEqual(['begin', 'observe', 'act', 'observe', 'plan', 'cancel'])
})
test('provider fallback obtains a screenshot before the visual planner', async () => {
  global.fetch = jest.fn().mockResolvedValue(reply({ success: true, fallback: true }))
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local', capabilities: { semanticControl: true } }
    if (input.operation === 'observe') return { ...observation, ...(input.semantic ? {} : { image: 'fresh' }) }
    if (input.operation === 'plan') return { success: true, question: 'Which note?' }
    return { success: true }
  }) }
  expect(await executeMiraComputerTask('Find a note', { token: 't' })).toMatchObject({ success: false, message: 'Which note?' })
  expect(window.electronAPI.computerTask.mock.calls.map(([x]) => x.operation)).toEqual(['begin', 'observe', 'observe', 'plan', 'cancel'])
})
test('Retry-After beyond the model budget returns without retrying', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, headers: { get: () => '60' } })
  expect((await fetchMiraDesktopPlan('/model', {})).status).toBe(429)
  expect(fetch).toHaveBeenCalledTimes(1)
})
test('semantic no-progress stops repeated actions despite changing screenshots', async () => {
  jest.useFakeTimers()
  let count = 0
  window.electronAPI = { computerTask: jest.fn(async input => {
    if (input.operation === 'begin') return { success: true, sessionId: 's', planner: 'agent-s-local' }
    if (input.operation === 'observe') return { ...observation, image: `animation${count++}` }
    if (input.operation === 'plan') return { success: true, action: { type: 'click', x: .1, y: .2 } }
    return { success: true }
  }) }
  const result = executeMiraComputerTask('Open search results', { token: 't' })
  await jest.runAllTimersAsync()
  expect(await result).toMatchObject({ success: false, message: expect.stringContaining('No verified progress') })
  expect(window.electronAPI.computerTask.mock.calls.filter(([x]) => x.operation === 'act')).toHaveLength(1)
})
