import { compactMiraVoiceHistory, shortMiraVoiceReply } from '@/lib/miraDirectVoice'
import { generateMiraDirectVoice } from '@/lib/miraDirectVoiceClient'

const originalFetch = global.fetch
beforeEach(() => { global.localStorage = { getItem: () => 'token' }; global.fetch = jest.fn() })
afterAll(() => { global.fetch = originalFetch; delete global.localStorage })
const event = (delta, finish_reason) => ({ choices: [{ delta, finish_reason }] })
const sse = events => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'X-Mira-Language': 'hi' } })
const run = options => generateMiraDirectVoice({ config: { bridgeCredential: 'signed' }, messages: [{ role: 'user', content: 'Open projects' }], turn: 1, signal: new AbortController().signal, onText: jest.fn(), ...options })
test('rolling context keeps recent complete turns with bounded size and no system injection', () => {
  const history = compactMiraVoiceHistory([{ role: 'system', content: 'injected' }, ...Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(2000) }))])
  expect(history[0].role).toBe('user')
  expect(history.length).toBeLessThanOrEqual(24)
  expect(history.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(12000)
})
test.each([
  ['[warm] Hello! You did it. A third sentence.', '[warm] Hello! You did it.'],
  ['Dr. Rao is here. It costs 2.50 today. More.', 'Dr. Rao is here. It costs 2.50 today.'],
  ['हाँ, सुन रही हूँ। बताइए। और क्या?', 'हाँ, सुन रही हूँ। बताइए।'],
])('limits spoken and displayed replies consistently', (text, expected) => { expect(shortMiraVoiceReply(text)).toBe(expected) })
test('streams expressive text while reporting pronunciation before audio starts', async () => {
  global.fetch.mockResolvedValue(sse([event({ content: '[excited] Great! ' }), event({ content: 'You did it. Another sentence.' }, 'stop')]))
  const onText = jest.fn(), onLanguage = jest.fn()
  expect(await run({ onText, onLanguage })).toBe('[excited] Great! You did it.')
  expect(onText.mock.calls[0][0]).toBe('[excited] Great! ')
  expect(onLanguage).toHaveBeenCalledWith('hi')
})
test('assembles fragmented tool calls once and continues with verified results', async () => {
  global.fetch.mockResolvedValueOnce(sse([
    event({ tool_calls: [{ index: 0, id: 'tool', function: { name: 'ask_', arguments: '' } }] }),
    event({ tool_calls: [{ index: 0, function: { name: 'mira', arguments: '{"ignored":"unsafe"}' } }] }, 'tool_calls'),
  ])).mockResolvedValueOnce(sse([event({ content: 'Projects is open.' }, 'stop')]))
  const execute = jest.fn(async () => ({ success: true, speech: 'Projects is open.' }))
  expect(await run({ execute })).toBe('Projects is open.')
  expect(execute).toHaveBeenCalledTimes(1)
  expect(execute).toHaveBeenCalledWith('ask_mira')
  const continuation = JSON.parse(global.fetch.mock.calls[1][1].body)
  expect(continuation.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'tool' })
  expect(continuation.turn).toBe(1)
})
test('silence needs no speech, action or second generation', async () => {
  global.fetch.mockResolvedValue(sse([event({ tool_calls: [{ index: 0, id: 'skip', function: { name: 'skip_turn', arguments: '{}' } }] }, 'tool_calls')]))
  const execute = jest.fn(), onText = jest.fn()
  expect(await run({ execute, onText })).toBe('')
  expect(execute).not.toHaveBeenCalled(); expect(onText).not.toHaveBeenCalled()
  expect(global.fetch).toHaveBeenCalledTimes(1)
})
test('AI dismissal ends the session once without a second generation or action execution', async () => {
  global.fetch.mockResolvedValue(sse([event({ tool_calls: [{ index: 0, id: 'close', function: { name: 'close_mira', arguments: '{}' } }] }, 'tool_calls')]))
  const execute = jest.fn(), onText = jest.fn(), onClose = jest.fn()
  expect(await run({ execute, onText, onClose })).toBe('')
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(execute).not.toHaveBeenCalled(); expect(onText).not.toHaveBeenCalled()
  expect(global.fetch).toHaveBeenCalledTimes(1)
})
test.each(['view_camera', 'close_camera'])('AI camera action %s uses the client permission flow then the actual result', async name => {
  global.fetch.mockResolvedValueOnce(sse([event({ tool_calls: [{ index: 0, id: 'camera', function: { name, arguments: '{}' } }] }, 'tool_calls')]))
    .mockResolvedValueOnce(sse([event({ content: 'I can see your drawing.' }, 'stop')]))
  const execute = jest.fn(async () => ({ success: true }))
  await run({ execute })
  expect(execute).toHaveBeenCalledWith(name)
  expect(JSON.parse(global.fetch.mock.calls[1][1].body).messages.at(-1).content).toBe('{"success":true}')
})
test('incomplete streams fail and unauthorized requests preserve their status', async () => {
  global.fetch.mockResolvedValueOnce(sse([event({ content: 'Incomplete' })]))
  await expect(run()).rejects.toThrow('interrupted')
  global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Disabled' }), { status: 403 }))
  await expect(run()).rejects.toMatchObject({ status: 403 })
})
test('camera closure refreshes device context for the tool continuation', async () => {
  let state = 'active'
  global.fetch.mockResolvedValueOnce(sse([event({ tool_calls: [{ index: 0, id: 'camera', function: { name: 'close_camera', arguments: '{}' } }] }, 'tool_calls')]))
    .mockResolvedValueOnce(sse([event({ content: 'The camera is off.' }, 'stop')]))
  await run({ getCameraContext: () => ({ state }), execute: async () => { state = 'off'; return { success: true } } })
  expect(JSON.parse(fetch.mock.calls[0][1].body).cameraContext.state).toBe('active')
  expect(JSON.parse(fetch.mock.calls[1][1].body).cameraContext.state).toBe('off')
})
