import { validateAgentSMessages, requestAgentSModel } from '@/lib/ai/agentSProxy'
const valid = () => [{ role: 'user', content: [{ type: 'text', text: 'Open WhatsApp' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,aGVsbG8=' } }] }]
afterEach(() => jest.restoreAllMocks())
test('model relay keeps only supported content and adds desktop policy', () => {
  const messages = validateAgentSMessages(valid())
  expect(messages[0].content).toContain('never Talio')
  expect(messages[1].content[1].image_url.detail).toBe('original')
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
