import { streamDeepSeekContent } from '@/lib/ai/providers/deepseekProvider'

const originalFetch = global.fetch
const originalKey = process.env.DEEPSEEK_API_KEY
beforeEach(() => { process.env.DEEPSEEK_API_KEY = 'test-only-not-a-real-key' })
afterEach(() => {
  global.fetch = originalFetch
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = originalKey
})
test('requests real upstream streaming and forwards incremental content', async () => {
  global.fetch = jest.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"delta":{"content":" there"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'))
  const deltas = []
  expect(await streamDeepSeekContent('Hi', 'Be concise', { onDelta: value => deltas.push(value) })).toBe('Hello there')
  expect(deltas).toEqual(['Hello', 'Hello there'])
  expect(JSON.parse(fetch.mock.calls[0][1].body).stream).toBe(true)
})
test('fails promptly on provider errors without retrying an emitted response', async () => {
  global.fetch = jest.fn().mockResolvedValue(new Response('unavailable', { status: 503 }))
  await expect(streamDeepSeekContent('Hi', '')).rejects.toThrow('DeepSeek API error 503')
  expect(fetch).toHaveBeenCalledTimes(1)
})
