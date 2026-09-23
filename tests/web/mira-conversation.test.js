import { renderHook, act } from '@testing-library/react'
import useMiraVoice, { speechText } from '@/hooks/useMiraVoice'
import { startMiraConversationRecognition } from '@/lib/miraConversationRecognition'
import { createMiraSpeechPlayback } from '@/lib/miraSpeechPlayback'
jest.mock('@/lib/miraConversationRecognition', () => ({ startMiraConversationRecognition: jest.fn() }))
jest.mock('@/lib/miraSpeechPlayback', () => ({ createMiraSpeechPlayback: jest.fn() }))
let callbacks, engine, spoken
let playback
beforeEach(() => {
  spoken = []
  engine = { stream: {}, stop: jest.fn(), setPaused: jest.fn() }
  startMiraConversationRecognition.mockImplementation(async options => { callbacks = options; return engine })
  playback = { close: jest.fn(), cancel: jest.fn(), speak: (text, onStart) => new Promise(resolve => { spoken.push({ text, onend: resolve }); onStart() }) }
  createMiraSpeechPlayback.mockReturnValue(playback)
})
test('recognized speech sends a turn, speaks its reply and resumes listening without echo', async () => {
  const sendMessage = jest.fn(async () => 'Hello there.')
  const { result } = renderHook(() => useMiraVoice({ open: true, busy: false, sendMessage }))
  await act(async () => result.current.start())
  expect(result.current.state).toBe('listening')
  let pending
  await act(async () => { pending = callbacks.onResult({ text: 'hello mira' }); await Promise.resolve() })
  expect(sendMessage).toHaveBeenCalledWith('hello mira', expect.objectContaining({ onResponse: expect.any(Function) }))
  expect(engine.setPaused).not.toHaveBeenCalled()
  expect(result.current.state).toBe('speaking')
  await act(async () => callbacks.onResult({ text: 'hello there' }))
  expect(sendMessage).toHaveBeenCalledTimes(1)
  await act(async () => { spoken[0].onend(); await pending })
  expect(result.current.state).toBe('listening')
  expect(engine.setPaused).not.toHaveBeenCalled()
})
test('stopping during a network request prevents late playback', async () => {
  let resolve
  const sendMessage = jest.fn(() => new Promise(done => { resolve = done }))
  const { result } = renderHook(() => useMiraVoice({ open: true, busy: false, sendMessage }))
  await act(async () => result.current.start())
  let pending
  act(() => { pending = callbacks.onResult({ text: 'hello' }) })
  act(() => result.current.stop())
  await act(async () => { resolve('Late response'); await pending })
  expect(spoken).toHaveLength(0)
  expect(engine.stop).toHaveBeenCalled()
})
test('closing stops capture and speech playback', async () => {
  const { result, rerender } = renderHook(({ open }) => useMiraVoice({ open, busy: false, sendMessage: async () => 'Hello.' }), { initialProps: { open: true } })
  await act(async () => result.current.start())
  await act(async () => { void callbacks.onResult({ text: 'hello' }); await Promise.resolve() })
  rerender({ open: false })
  expect(engine.stop).toHaveBeenCalled()
  expect(playback.close).toHaveBeenCalled()
  expect(result.current.state).toBe('idle')
})
test('speech output skips code syntax and markdown decoration', () => {
  expect(speechText('**Hello**\n```js\nalert(1)\n```')).toBe('Hello\n Code is shown in the chat.')
})

test('a final goodbye stops a busy session and passes through the local structured-dismiss path', async () => {
  const sendMessage = jest.fn(), onDismiss = jest.fn()
  const { result } = renderHook(() => useMiraVoice({ open: true, busy: true, sendMessage, onDismiss }))
  await act(async () => result.current.start())
  act(() => callbacks.onPartial('bye'))
  expect(onDismiss).not.toHaveBeenCalled()
  const goodbye = 'ठीक है, मेरा। Done, done. बस, ठीक है। Bye, bye.'
  await act(async () => callbacks.onResult({ text: goodbye }))
  expect(onDismiss).toHaveBeenCalledTimes(1)
  expect(engine.stop).toHaveBeenCalledTimes(1)
  expect(playback.close).toHaveBeenCalledTimes(1)
  expect(result.current.active).toBe(false)
  expect(sendMessage).toHaveBeenCalledWith(goodbye)
  expect(spoken).toHaveLength(0)
})

test('dismissal cancels speaking and does not let a late reply reopen voice', async () => {
  const onDismiss = jest.fn()
  const { result } = renderHook(() => useMiraVoice({ open: true, busy: false, sendMessage: async () => 'Here is your answer.', onDismiss }))
  await act(async () => result.current.start())
  let pending
  await act(async () => { pending = callbacks.onResult({ text: 'Help me' }); await Promise.resolve() })
  expect(result.current.state).toBe('speaking')
  await act(async () => callbacks.onResult({ text: 'bye' }))
  expect(onDismiss).toHaveBeenCalledTimes(1)
  await act(async () => { spoken[0].onend(); await pending })
  expect(result.current.state).toBe('idle')
})
