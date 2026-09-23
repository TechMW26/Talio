import { generateDeepSeekContent, streamDeepSeekContent } from '@/lib/ai/providers/deepseekProvider'
import { generateContent, generateVisionContent, getAIAvailability } from '@/lib/ai/aiProviderManager'

const originalEnv = process.env
beforeEach(() => {
  process.env = { ...originalEnv, DEEPSEEK_API_KEY: 'test-secret', POLLINATIONS_API_KEY: 'test-vision' }
  delete process.env.DEEPSEEK_FLASH_MODEL
  delete process.env.DEEPSEEK_PRO_MODEL
  global.fetch = jest.fn()
})
afterEach(() => { process.env = originalEnv; jest.restoreAllMocks() })
const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }))

test('missing DeepSeek fails closed even when Pollinations is configured', async () => {
  delete process.env.DEEPSEEK_API_KEY
  await expect(generateContent('hello')).rejects.toThrow('DeepSeek is not configured')
  expect(fetch).not.toHaveBeenCalled()
  expect(getAIAvailability()).toMatchObject({ textAvailable: false, visionAvailable: true })
})
test('Pro can fall back only to DeepSeek Flash on a missing model', async () => {
  fetch.mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(ok())
  await generateDeepSeekContent('Analyze', '', { useCase: 'analysis' })
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(Array(2).fill('https://api.deepseek.com/chat/completions'))
  expect(fetch.mock.calls.map(([, request]) => JSON.parse(request.body).model)).toEqual(['deepseek-v4-pro', 'deepseek-flash'])
})
test('routine text disables thinking and complex actions enable it', async () => {
  fetch.mockImplementation(async () => ok())
  await generateDeepSeekContent('Hello', '', { useCase: 'mira' })
  await generateDeepSeekContent('Create a project', '', { useCase: 'mira-actions' })
  expect(fetch.mock.calls.map(([, request]) => JSON.parse(request.body).thinking.type)).toEqual(['disabled', 'enabled'])
})
test('vision stays on Pollinations even with an analysis use case', async () => {
  fetch.mockResolvedValueOnce(ok())
  await generateVisionContent('Read', [{ data: 'abc', mimeType: 'image/png' }], { useCase: 'analysis' })
  expect(fetch.mock.calls[0][0]).toContain('gen.pollinations.ai')
  expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('gemini')
})
test('truncated streams fail and never replay a partial reply', async () => {
  fetch.mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
  await expect(streamDeepSeekContent('Hello')).rejects.toThrow('before completion')
  expect(fetch).toHaveBeenCalledTimes(1)
})
test('reasoning tokens stay private while final content streams', async () => {
  fetch.mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"reasoning_content":"private"}}]}\n\ndata: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'))
  const onDelta = jest.fn()
  expect(await streamDeepSeekContent('Hi', '', { onDelta })).toBe('OK')
  expect(onDelta).toHaveBeenCalledTimes(1)
  expect(onDelta).toHaveBeenCalledWith('OK')
})
test('cancellation reaches the upstream request', async () => {
  const controller = new AbortController()
  fetch.mockImplementation(async (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  }))
  const result = streamDeepSeekContent('Hi', '', { signal: controller.signal })
  controller.abort()
  await expect(result).rejects.toMatchObject({ name: 'AbortError' })
})
