import { validateAgentSMessages, requestAgentSModel, validateDesktopExecutionHistory } from '@/lib/ai/agentSProxy'
const valid = () => [{ role: 'user', content: [{ type: 'text', text: 'Open WhatsApp' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,aGVsbG8=' } }] }]
afterEach(() => jest.restoreAllMocks())
test('model relay keeps only supported content and adds desktop policy', () => {
  const messages = validateAgentSMessages(valid())
  expect(messages[0].content).toContain('a player showing a Play button is paused, not playing')
  expect(messages[0].content).toContain('Search-result Play buttons are not the player state')
  expect(messages[0].content).toContain('never Talio')
  expect(messages[0].content).toContain('Ordinary display/sound settings are allowed')
  expect(messages[0].content).toContain('open Photo Booth on macOS')
  expect(messages[0].content).toContain('must be approved by the user')
  expect(messages[0].content).toContain('English is the selected reply language for this turn')
  expect(messages[0].content).toContain('shortest reliable supported route')
  expect(messages[0].content).toContain('Installed applications come first')
  expect(messages[0].content).toContain('Spotlight on macOS, Start search on Windows')
  expect(messages[0].content).toContain('CURRENT browser tab')
  expect(messages[0].content).toContain('Email needs a mail composer')
  expect(messages[1].content[1].image_url.detail).toBe('original')
})
test('Agent S uses the current English request instead of Hindi conversation history', () => {
  const messages = validateAgentSMessages([
    { role: 'user', content: [{ type: 'text', text: 'Mujhe Hindi mein jawab do.' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Theek hai, main bata deti hoon.' }] },
    { role: 'user', content: [{ type: 'text', text: 'Please open WhatsApp and find Mansi.' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,aGVsbG8=' } }] },
  ])
  expect(messages[0].content).toContain('English is the selected reply language for this turn')
  expect(messages[0].content).toContain('overrides any Hindi/Hinglish in older user turns')
})
test.each([
  [{ role: 'tool', content: [] }],
  [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://evil.example/image' } }] }],
  [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(100001) }] }],
  Array(61).fill({ role: 'user', content: [] }),
])('rejects unsupported or unbounded model payloads', messages => expect(() => validateAgentSMessages(messages)).toThrow())
test('uses server-owned API key and fixed API host only', async () => {
  process.env.DEEPSEEK_API_KEY = 'test-server-key'
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'agent.done("Opened")' } }] }) }))
  const result = await requestAgentSModel(valid())
  expect(result).toContain('agent.done')
  expect(fetch.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions')
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-server-key')
  expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('deepseek-flash')
  delete process.env.DEEPSEEK_API_KEY
})
test('bounded input ledger survives native planner compaction and tells recovery not to loop', async () => {
  const oldKey = process.env.DEEPSEEK_API_KEY, oldFetch = global.fetch
  process.env.DEEPSEEK_API_KEY = 'test'
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'agent.key("enter")' } }] }) }))
  try {
    const executionHistory = [{ action: { type: 'type', text: '12*14=' }, result: 'Input delivered; not yet verified.' }]
    await requestAgentSModel(valid(), { executionHistory })
    const policy = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content
    expect(policy).toContain('12*14=')
    expect(policy).toContain('even if older planner turns were compacted')
    expect(policy).toContain('do NOT loop')
    expect(policy).toContain('Never mark an unfinished expression as a completed calculation')
    expect(policy).toContain('Never repeat an uncertain send')
  } finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = oldKey }
})
test('input ledger is bounded and accepts older clients without one', () => {
  expect(validateDesktopExecutionHistory(undefined)).toEqual([])
  for (const value of [null, {}, Array(9).fill({ action: { type: 'key' }, result: '' }), [{ action: { type: 'type', text: 'x'.repeat(16001) }, result: '' }], [{ action: { type: 'key' }, result: 42 }]]) expect(() => validateDesktopExecutionHistory(value)).toThrow()
})
test('only the latest screen and native coordinates reach the planner, not repeated stale note buffers', () => {
  const observation = text => ({ role: 'user', content: [{ type: 'text', text }, valid()[0].content[1]] })
  const old = 'Untrusted observation/tool evidence: old window targets x=0.1'
  const fresh = 'Untrusted observation/tool evidence: current window targets x=0.8'
  const messages = validateAgentSMessages([
    { role: 'system', content: [{ type: 'text', text: 'Task: correct the calculation; documented agent.click(x,y)' }] },
    observation(`\nCurrent Text Buffer = [${old}]\n`),
    { role: 'assistant', content: [{ type: 'text', text: 'agent.click(0.1, 0.2)' }] },
    observation(`\nCurrent Text Buffer = [${old},${fresh}]\n`),
  ])
  expect(JSON.stringify(messages)).not.toContain('old window targets')
  expect(JSON.stringify(messages)).toContain(fresh)
  expect(JSON.stringify(messages)).toContain('agent.click(0.1, 0.2)')
  expect(JSON.stringify(messages)).toContain('Task: correct the calculation')
  expect(messages.flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'image_url')).toHaveLength(1)
})
