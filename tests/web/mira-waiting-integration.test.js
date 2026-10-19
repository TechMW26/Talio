import { act, renderHook } from '@testing-library/react'
import useMiraVoice from '@/hooks/useMiraVoice'
import { startMiraConversationRecognition } from '@/lib/miraConversationRecognition'
import { createMiraSpeechPlayback } from '@/lib/miraSpeechPlayback'
import { generateMiraDirectVoice } from '@/lib/miraDirectVoiceClient'
jest.mock('@/lib/miraConversationRecognition', () => ({ startMiraConversationRecognition: jest.fn() }))
jest.mock('@/lib/miraSpeechPlayback', () => ({ createMiraSpeechPlayback: jest.fn() }))
jest.mock('@/lib/miraDirectVoiceClient', () => ({ generateMiraDirectVoice: jest.fn() }))
let callbacks, answer, playback, ready
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks()
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ voiceId: 'selected', language: 'en', bridgeCredential: 'private' }) }))
  startMiraConversationRecognition.mockImplementation(async options => { callbacks = options; return { stop: jest.fn() } })
  answer = { result: new Promise(resolve => { ready = resolve }), cancel: jest.fn() }
  playback = { close: jest.fn(), cancel: jest.fn(), prepare: jest.fn(() => answer), speak: jest.fn(async (text, onStart, ticket) => { await ticket.result; onStart() }) }
  createMiraSpeechPlayback.mockReturnValue(playback)
  generateMiraDirectVoice.mockImplementation(async options => { options.onText('[confident] Your task is due today.'); return '[confident] Your task is due today.' })
})
afterEach(() => { jest.useRealTimers(); delete global.fetch })
test('starts preparing the actual answer immediately and never creates waiting fillers', async () => {
  const { result } = renderHook(() => useMiraVoice({ open: true }))
  await act(async () => result.current.start())
  let turn
  await act(async () => { turn = callbacks.onResult({ text: 'Check my task deadline' }); await Promise.resolve() })
  await act(async () => jest.advanceTimersByTimeAsync(700))
  expect(playback.prepare).toHaveBeenCalledTimes(1)
  expect(playback.speak.mock.calls[0][2]).toBe(answer)
  await act(async () => { ready({ response: {} }); await turn })
  expect(playback.speak).toHaveBeenCalledTimes(1)
  expect(playback.speak.mock.calls[0][0]).toBe('[confident] Your task is due today.')
  expect(result.current.state).toBe('listening')
})
test('fast audio speaks only the answer', async () => {
  const { result } = renderHook(() => useMiraVoice({ open: true }))
  await act(async () => result.current.start())
  ready({ response: {} })
  await act(async () => callbacks.onResult({ text: 'Check my task deadline' }))
  await act(async () => jest.advanceTimersByTimeAsync(3000))
  expect(playback.speak).toHaveBeenCalledTimes(1)
  expect(playback.speak.mock.calls[0][0]).toBe('[confident] Your task is due today.')
})
test('semantic goodbye while awaiting audio closes playback and the conversation', async () => {
  const onDismiss = jest.fn()
  const { result } = renderHook(() => useMiraVoice({ open: true, onDismiss }))
  await act(async () => result.current.start())
  let turn
  await act(async () => { turn = callbacks.onResult({ text: 'Check my task deadline' }); await Promise.resolve() })
  await act(async () => jest.advanceTimersByTimeAsync(700))
  generateMiraDirectVoice.mockImplementationOnce(async options => { options.onClose(); return '' })
  await act(async () => callbacks.onResult({ text: 'Bye-bye Mira' }))
  await act(async () => { ready({ response: {} }); await turn })
  expect(onDismiss).toHaveBeenCalledTimes(1)
  expect(playback.close).toHaveBeenCalledTimes(1)
  expect(playback.speak).toHaveBeenCalledTimes(1)
  expect(result.current.active).toBe(false)
})
