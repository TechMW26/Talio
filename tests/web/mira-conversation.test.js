import { renderHook, act } from '@testing-library/react'
import useMiraVoice, { speechText } from '@/hooks/useMiraVoice'
import { startMiraConversationRecognition } from '@/lib/miraConversationRecognition'
import { createMiraSpeechPlayback } from '@/lib/miraSpeechPlayback'
import { generateMiraDirectVoice } from '@/lib/miraDirectVoiceClient'
jest.mock('@/lib/miraConversationRecognition', () => ({ startMiraConversationRecognition: jest.fn() }))
jest.mock('@/lib/miraSpeechPlayback', () => ({ createMiraSpeechPlayback: jest.fn() }))
jest.mock('@/lib/miraDirectVoiceClient', () => ({ generateMiraDirectVoice: jest.fn() }))
let callbacks, engine, playback
beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ voiceId: 'selected', language: 'en', bridgeCredential: 'private', renewAfterMs: 540000 }) }))
  engine = { stop: jest.fn(), getLevel: () => .2 }
  startMiraConversationRecognition.mockImplementation(async options => { callbacks = options; return engine })
  playback = { close: jest.fn(), cancel: jest.fn(), getLevel: () => .4, speak: jest.fn(async (_, onStart) => onStart()) }
  createMiraSpeechPlayback.mockReturnValue(playback)
  generateMiraDirectVoice.mockImplementation(async options => { options.onText('[warm][fast] Hello there.'); return '[warm][fast] Hello there.' })
})
afterEach(() => { jest.useRealTimers(); delete global.fetch })

test('stays silently connected without a four-second cutoff or unsolicited generation', async () => {
  jest.useFakeTimers()
  const { result } = renderHook(() => useMiraVoice({ open: true }))
  await act(async () => result.current.start())
  act(() => jest.advanceTimersByTime(60000))
  await act(async () => callbacks.onResult({ text: '...' }))
  expect(result.current.state).toBe('listening')
  expect(generateMiraDirectVoice).not.toHaveBeenCalled()
  expect(engine.stop).not.toHaveBeenCalled()
})
test('shows user and generated transcripts, retains emotion for audio, and uses no chat request for conversation', async () => {
  const sendMessage = jest.fn(), recordVoiceMessage = jest.fn()
  const { result } = renderHook(() => useMiraVoice({ open: true, sendMessage, recordVoiceMessage }))
  await act(async () => result.current.start())
  act(() => callbacks.onPartial('Hello'))
  expect(result.current.transcript).toBe('Hello')
  await act(async () => callbacks.onResult({ text: 'Hello Mira' }))
  expect(result.current.captions.map(m => m.content)).toEqual(['Hello Mira', 'Hello there.'])
  expect(playback.speak.mock.calls[0][0]).toBe('[warm][fast] Hello there.')
  expect(sendMessage).not.toHaveBeenCalled()
  expect(global.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/ai/mira-voice/session'])
  expect(result.current.level()).toBe(.4)
  act(() => result.current.stop())
  expect(result.current.level()).toBe(0)
  expect(recordVoiceMessage.mock.calls.at(-1)[0].messages).toHaveLength(2)
})
test('reuses session context and rolling history between turns, without fetching a profile again', async () => {
  const { result } = renderHook(() => useMiraVoice({ open: true, history: [{ role: 'user', content: 'My project is Talio.' }] }))
  await act(async () => result.current.start())
  await act(async () => callbacks.onResult({ text: 'Hello Mira' }))
  await act(async () => callbacks.onResult({ text: 'What is my project?' }))
  expect(global.fetch).toHaveBeenCalledTimes(1)
  expect(generateMiraDirectVoice.mock.calls[1][0].messages).toEqual([
    { role: 'user', content: 'My project is Talio.' }, { role: 'user', content: 'Hello Mira' },
    { role: 'assistant', content: '[warm][fast] Hello there.' }, { role: 'user', content: 'What is my project?' },
  ])
})
test('only the exact accepted transcript can enter an action and verified failure remains a failure', async () => {
  const sendMessage = jest.fn(async (text, opts) => { opts.onSpeech('Could not open it.'); opts.onActionResult({ success: false, uncertain: true }); return undefined })
  let outcome
  generateMiraDirectVoice.mockImplementation(async options => { outcome = await options.execute('ask_mira'); options.onText('[warm] Could not confirm it opened.'); return '[warm] Could not confirm it opened.' })
  const { result } = renderHook(() => useMiraVoice({ open: true, sendMessage }))
  await act(async () => result.current.start())
  await act(async () => callbacks.onResult({ text: 'Open projects' }))
  expect(sendMessage).toHaveBeenCalledTimes(1)
  expect(sendMessage.mock.calls[0][0]).toBe('Open projects')
  expect(outcome).toMatchObject({ speech: 'Could not open it.', actionOutcome: { success: false, uncertain: true } })
})
test.each(['Mira bye', 'bye Mire', 'Mire close', "Let's end this conversation", 'मीरा बातचीत खत्म करो'])('final dismissal closes mic and playback without a model request: %s', async text => {
  const onDismiss = jest.fn(), sendMessage = jest.fn()
  const { result } = renderHook(() => useMiraVoice({ open: true, onDismiss, sendMessage }))
  await act(async () => result.current.start())
  act(() => callbacks.onPartial('bye'))
  expect(onDismiss).not.toHaveBeenCalled()
  await act(async () => callbacks.onResult({ text }))
  expect(onDismiss).toHaveBeenCalledTimes(1)
  expect(engine.stop).toHaveBeenCalledTimes(1)
  expect(playback.close).toHaveBeenCalledTimes(1)
  expect(generateMiraDirectVoice).not.toHaveBeenCalled()
  expect(sendMessage).not.toHaveBeenCalled()
})
test('closing aborts generation and prevents late audio or captions', async () => {
  let resolve
  generateMiraDirectVoice.mockImplementation(() => new Promise(done => { resolve = done }))
  const { result, rerender } = renderHook(({ open }) => useMiraVoice({ open }), { initialProps: { open: true } })
  await act(async () => result.current.start())
  let pending
  await act(async () => { pending = callbacks.onResult({ text: 'Hello' }); await Promise.resolve() })
  const signal = generateMiraDirectVoice.mock.calls[0][0].signal
  rerender({ open: false })
  expect(signal.aborted).toBe(true)
  await act(async () => { resolve('Late reply.'); await pending })
  expect(playback.speak).not.toHaveBeenCalled()
  expect(result.current.state).toBe('idle')
})
test('hung startup exits loading and releases late microphone capture once', async () => {
  jest.useFakeTimers()
  let resolveEngine, pending
  startMiraConversationRecognition.mockImplementationOnce(() => new Promise(resolve => { resolveEngine = resolve }))
  const { result } = renderHook(() => useMiraVoice({ open: true }))
  act(() => { pending = result.current.start() })
  await act(async () => { await jest.advanceTimersByTimeAsync(10000); await pending })
  expect(result.current.state).toBe('idle')
  expect(result.current.error).toMatch(/type now or retry/)
  const late = { stop: jest.fn() }
  await act(async () => { resolveEngine(late) })
  expect(late.stop).toHaveBeenCalledTimes(1)
})
test('closing and restarting does not leak the previous conversation into a different account/session', async () => {
  const { result } = renderHook(() => useMiraVoice({ open: true, history: [] }))
  await act(async () => result.current.start())
  await act(async () => callbacks.onResult({ text: 'Private old question' }))
  act(() => result.current.stop())
  await act(async () => result.current.start())
  expect(result.current.captions).toEqual([])
  await act(async () => callbacks.onResult({ text: 'New question' }))
  expect(generateMiraDirectVoice.mock.calls.at(-1)[0].messages).toEqual([{ role: 'user', content: 'New question' }])
})
test('speech cleans markdown but preserves expressive audio tags', () => {
  expect(speechText('**[warm] Hello**')).toBe('[warm] Hello')
})
