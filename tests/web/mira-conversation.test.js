import { renderHook, act } from '@testing-library/react'
import useMiraVoice, { speechText } from '@/hooks/useMiraVoice'
import { startMiraConversationRecognition } from '@/lib/miraConversationRecognition'
import { createMiraSpeechPlayback } from '@/lib/miraSpeechPlayback'
jest.mock('@/lib/miraConversationRecognition', () => ({ startMiraConversationRecognition: jest.fn() }))
jest.mock('@/lib/miraSpeechPlayback', () => ({ createMiraSpeechPlayback: jest.fn() }))
let callbacks, engine, spoken
let playback
describe('four-second idle voice timeout', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())
  test('stops idle capture at four seconds without dismissing chat', async () => {
    const onDismiss = jest.fn()
    const { result } = renderHook(() => useMiraVoice({ open: true, busy: false, sendMessage: jest.fn(), onDismiss }))
    await act(async () => result.current.start())
    act(() => jest.advanceTimersByTime(3999))
    expect(result.current.active).toBe(true)
    act(() => jest.advanceTimersByTime(1))
    expect(result.current.state).toBe('idle')
    expect(engine.stop).toHaveBeenCalledTimes(1)
    expect(playback.close).toHaveBeenCalledTimes(1)
    expect(onDismiss).not.toHaveBeenCalled()
  })
  test('speech resets the timer but empty transcripts do not', async () => {
    const { result } = renderHook(() => useMiraVoice({ open: true, busy: false, sendMessage: jest.fn() }))
    await act(async () => result.current.start())
    act(() => { jest.advanceTimersByTime(3000); callbacks.onPartial('Hello Mira') })
    act(() => { jest.advanceTimersByTime(3000); callbacks.onPartial('') })
    expect(result.current.active).toBe(true)
    act(() => jest.advanceTimersByTime(1000))
    expect(result.current.active).toBe(false)
  })
  test('does not interrupt thinking or playback; re-arms after the reply', async () => {
    let resolveReply, pending
    const sendMessage = jest.fn(() => new Promise(resolve => { resolveReply = resolve }))
    const { result } = renderHook(() => useMiraVoice({ open: true, busy: false, sendMessage }))
    await act(async () => result.current.start())
    act(() => { pending = callbacks.onResult({ text: 'Help me' }) })
    act(() => jest.advanceTimersByTime(8000))
    expect(result.current.state).toBe('thinking')
    await act(async () => { resolveReply('Here is the answer.'); await Promise.resolve() })
    act(() => jest.advanceTimersByTime(8000))
    expect(result.current.state).toBe('speaking')
    await act(async () => { spoken[0].onend(); await pending })
    act(() => jest.advanceTimersByTime(4000))
    expect(result.current.state).toBe('idle')
  })
  test('busy tasks suspend timeout and restarting gets a fresh timer', async () => {
    const { result, rerender } = renderHook(({ busy }) => useMiraVoice({ open: true, busy, sendMessage: jest.fn() }), { initialProps: { busy: false } })
    await act(async () => result.current.start())
    act(() => jest.advanceTimersByTime(3000))
    rerender({ busy: true })
    act(() => jest.advanceTimersByTime(8000))
    expect(result.current.active).toBe(true)
    rerender({ busy: false })
    act(() => jest.advanceTimersByTime(3000))
    act(() => result.current.stop())
    await act(async () => result.current.start())
    act(() => jest.advanceTimersByTime(1000))
    expect(result.current.active).toBe(true)
    act(() => jest.advanceTimersByTime(3000))
    expect(result.current.active).toBe(false)
  })
})
test('hung voice initialization exits loading and releases a late microphone session', async () => {
  jest.useFakeTimers()
  let resolveEngine, pending
  startMiraConversationRecognition.mockImplementationOnce(() => new Promise(resolve => { resolveEngine = resolve }))
  const { result, unmount } = renderHook(() => useMiraVoice({ open: true, busy: false, sendMessage: jest.fn() }))
  try {
    act(() => { pending = result.current.start() })
    expect(result.current.state).toBe('loading')
    await act(async () => { await jest.advanceTimersByTimeAsync(10000); await pending })
    expect(result.current.state).toBe('idle')
    expect(result.current.error).toMatch(/type now or retry/)
    expect(playback.close).toHaveBeenCalled()
    const late = { stop: jest.fn() }
    await act(async () => { resolveEngine(late); await Promise.resolve() })
    expect(late.stop).toHaveBeenCalled()
    expect(result.current.state).toBe('idle')
  } finally { unmount(); jest.useRealTimers() }
})
test('empty action return does not block subsequent voice turns or replay actions', async () => {
  const sendMessage = jest.fn(async () => undefined)
  const { result } = renderHook(() => useMiraVoice({ open: true, busy: false, sendMessage }))
  await act(async () => result.current.start())
  await act(async () => callbacks.onResult({ text: 'Open Notes' }))
  expect(result.current.error).toBe('')
  expect(result.current.state).toBe('listening')
  await act(async () => callbacks.onResult({ text: 'Open Calendar' }))
  expect(sendMessage).toHaveBeenCalledTimes(2)
})
test('callback speech is used even when the action has no return text', async () => {
  playback = { ...playback, speak: jest.fn(async () => {}) }
  createMiraSpeechPlayback.mockReturnValue(playback)
  const sendMessage = jest.fn(async (_, options) => { options.onSpeech('Notes is open.'); return undefined })
  const { result } = renderHook(() => useMiraVoice({ open: true, busy: false, sendMessage }))
  await act(async () => result.current.start())
  await act(async () => callbacks.onResult({ text: 'Open Notes' }))
  expect(playback.speak).toHaveBeenCalled()
  expect(result.current.error).toBe('')
  expect(result.current.state).toBe('listening')
})
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
  expect(sendMessage).toHaveBeenCalledWith('hello mira', expect.objectContaining({ inputMode: 'voice', onSpeech: expect.any(Function) }))
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
  expect(speechText('**Hello**\n```js\nalert(1)\n```')).toBe('Hello')
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
