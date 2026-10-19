import { desktopResponseKey, cachedDesktopResponse, saveDesktopResponse } from '@/lib/ai/miraDesktopResponseCache'
import { requestAgentSModel } from '@/lib/ai/agentSProxy'
const messages = [{ role: 'user', content: [{ type: 'text', text: 'Open Notes. macOS 14. Current app Finder.' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }] }]
const scope = { tenant: 'tenant1', user: 'user1' }
test('cache isolation includes account, model and exact screen/context; entries expire', () => {
  jest.useFakeTimers()
  try {
    const key = desktopResponseKey(scope, 'model', messages)
    saveDesktopResponse(key, '```python\nagent.open_app("Notes")\n```')
    expect(cachedDesktopResponse(key)).toContain('open_app')
    for (const other of [desktopResponseKey({ ...scope, user: 'other' }, 'model', messages), desktopResponseKey({ ...scope, tenant: 'other' }, 'model', messages), desktopResponseKey(scope, 'different', messages), desktopResponseKey(scope, 'model', [...messages, { role: 'user', content: 'changed' }])]) expect(cachedDesktopResponse(other)).toBeNull()
    jest.advanceTimersByTime(60001)
    expect(cachedDesktopResponse(key)).toBeNull()
  } finally { jest.useRealTimers() }
})
test.each(['agent.done("Sent")', 'agent.ask("Who?")', 'agent.click(0.2,0.3)', 'agent.key("enter")', 'agent.type("password")', 'agent.batch([{"type":"key","key":"enter"}])'])('never caches unsafe or completion result %s', code => {
  const key = desktopResponseKey(scope, code, messages)
  saveDesktopResponse(key, `\`\`\`python\n${code}\n\`\`\``)
  expect(cachedDesktopResponse(key)).toBeNull()
})
test('identical authenticated screenshot request avoids second provider generation', async () => {
  const original = global.fetch, apiKey = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = 'test-only'
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '```python\nagent.open_app("Notes")\n```' } }] }) }))
  try {
    const cacheScope = { tenant: 'integration', user: 'one' }
    expect(await requestAgentSModel(messages, { cacheScope })).toContain('open_app')
    expect(await requestAgentSModel(messages, { cacheScope })).toContain('open_app')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    await requestAgentSModel(messages, { cacheScope, bypassCache: true })
    expect(global.fetch).toHaveBeenCalledTimes(2)
    await requestAgentSModel(messages, { cacheScope: { ...cacheScope, user: 'two' } })
    expect(global.fetch).toHaveBeenCalledTimes(3)
  } finally { global.fetch = original; if (apiKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = apiKey }
})
