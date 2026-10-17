import { requestHybridDesktop, validateHybridRequest } from '@/lib/ai/miraHybridDesktop'
import { semanticCandidates, semanticFingerprint } from '../../desktop-app/src/miraSemantic'

const input = { operation: 'plan', goal: 'Search Notes for नमस्ते', app: 'Notes', targets: [{ ref: 'a', role: 'AXSearchField', label: 'Search' }] }
const planReply = { choices: [{ message: { content: JSON.stringify({ steps: [{ operation: 'fill', app: 'Notes', target: 'Search', text: 'नमस्ते' }] }) } }] }
const choice = (ref = 'a', confidence = .99) => ({ answers: { target: { type: 'choice', choice: ref, confidence, probabilities: { [ref]: .99 } } } })
const respond = data => ({ ok: true, json: async () => data })
beforeEach(() => {
  process.env.TYPESAFE_API_KEY = 'test-typesafe'; process.env.DEEPSEEK_API_KEY = 'test-deepseek'; process.env.JWT_SECRET = 'test-only-secret'; process.env.MIRA_JEV_ENABLED = 'true'
  global.fetch = jest.fn().mockResolvedValueOnce(respond(planReply)).mockResolvedValue(respond(choice()))
})
afterEach(() => { for (const name of ['TYPESAFE_API_KEY', 'DEEPSEEK_API_KEY', 'JWT_SECRET', 'MIRA_JEV_ENABLED']) delete process.env[name] })
test('one DeepSeek plan followed by Jev control selection preserves Hindi and returns no completion claim', async () => {
  const plan = await requestHybridDesktop(input, 'tenant:user')
  expect(plan.count).toBe(1)
  const result = await requestHybridDesktop({ ...input, operation: 'select', plan: plan.plan, index: 0 }, 'tenant:user')
  expect(result).toEqual({ success: true, action: { type: 'semantic', operation: 'fill', ref: 'a', text: 'नमस्ते' } })
  expect(fetch.mock.calls.map(call => call[0])).toEqual(['https://api.deepseek.com/chat/completions', 'https://api.typesafe.ai/v1/systemone'])
  const body = JSON.parse(fetch.mock.calls[1][1].body)
  expect(body).not.toHaveProperty('assets')
  expect(body.state).not.toHaveProperty('text')
  expect(body.model).toBe('jev-1.13.0')
})
test('signed plan cannot cross tenant, user, goal or expiration boundaries', async () => {
  const plan = await requestHybridDesktop(input, 'tenant:user')
  const select = { ...input, operation: 'select', plan: plan.plan, index: 0 }
  for (const identity of ['other:user', 'tenant:other']) await expect(requestHybridDesktop(select, identity)).rejects.toThrow()
  await expect(requestHybridDesktop({ ...select, goal: 'Delete everything' }, 'tenant:user')).rejects.toThrow()
  await expect(requestHybridDesktop({ ...select, plan: 'tampered.signature' }, 'tenant:user')).rejects.toThrow()
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 300001)
  await expect(requestHybridDesktop(select, 'tenant:user')).rejects.toThrow()
  clock.mockRestore()
  expect(fetch).toHaveBeenCalledTimes(1)
})
test.each([choice('NONE'), choice('invented'), choice('a', .4), { answers: { target: { choice: 'a', confidence: 1 } } }])('rejects unsafe or uncertain Jev answers', async answer => {
  const plan = await requestHybridDesktop(input, 't:u')
  fetch.mockResolvedValue(respond(answer))
  expect(await requestHybridDesktop({ ...input, operation: 'select', plan: plan.plan, index: 0 }, 't:u')).toMatchObject({ fallback: true })
})
test('missing configuration and provider rate limits fall back, without an internal retry loop', async () => {
  delete process.env.TYPESAFE_API_KEY
  expect(await requestHybridDesktop(input, 't:u')).toMatchObject({ fallback: true })
  expect(fetch).not.toHaveBeenCalled()
  process.env.TYPESAFE_API_KEY = 'test'
  const plan = await requestHybridDesktop(input, 't:u')
  fetch.mockResolvedValue({ ok: false, status: 429 })
  expect(await requestHybridDesktop({ ...input, operation: 'select', plan: plan.plan, index: 0 }, 't:u')).toMatchObject({ fallback: true, reason: 'rate_limited' })
  expect(fetch).toHaveBeenCalledTimes(2)
})
test('filters sensitive and committing controls at both API and native boundaries', () => {
  const targets = ['Search', 'Send message', 'Delete', 'Password', 'OTP', 'भेजें'].map((label, i) => ({ ref: String(i), role: 'AXButton', label }))
  expect(semanticCandidates(targets, 'click').map(t => t.label)).toEqual(['Search'])
  expect(semanticCandidates(targets, 'fill')).toEqual([])
  expect(semanticFingerprint('Notes', '1', [{ ...targets[0], x: .1, y: .2 }])).toBe(semanticFingerprint('Notes', '1', [{ ...targets[0], ref: 'fresh-ref', x: .1, y: .2 }]))
})
test('validates bounded inputs and rejects duplicate references', () => {
  for (const bad of [{ ...input, goal: 'x'.repeat(3001) }, { ...input, targets: Array(61).fill(input.targets[0]) }, { ...input, targets: [input.targets[0], input.targets[0]] }, { ...input, operation: 'select', plan: 'x', index: 8 }]) expect(() => validateHybridRequest(bad)).toThrow()
})
test('app changes cannot execute a cached step', async () => {
  const plan = await requestHybridDesktop(input, 't:u')
  expect(await requestHybridDesktop({ ...input, app: 'Mail', operation: 'select', plan: plan.plan, index: 0 }, 't:u')).toMatchObject({ fallback: true, reason: 'app_changed' })
  expect(fetch).toHaveBeenCalledTimes(1)
})
