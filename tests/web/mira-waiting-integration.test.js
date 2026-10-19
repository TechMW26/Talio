import { act, renderHook } from '@testing-library/react'
import useMiraVoice from '@/hooks/useMiraVoice'
import { startMiraConversationRecognition } from '@/lib/miraConversationRecognition'
import { createMiraSpeechPlayback } from '@/lib/miraSpeechPlayback'
import { generateMiraDirectVoice } from '@/lib/miraDirectVoiceClient'
jest.mock('@/lib/miraConversationRecognition', () => ({ startMiraConversationRecognition: jest.fn() }))
jest.mock('@/lib/miraSpeechPlayback', () => ({ createMiraSpeechPlayback: jest.fn() }))
jest.mock('@/lib/miraDirectVoiceClient', () => ({ generateMiraDirectVoice: jest.fn() }))
let callbacks, filler, answer, playback, ready, finishFiller
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks()
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ voiceId: 'selected', language: 'en', bridgeCredential: 'private' }) }))
  startMiraConversationRecognition.mockImplementation(async options => { callbacks = options; return { stop: jest.fn() } })
  filler = { result: Promise.resolve({ response: {} }), cancel: jest.fn() }
  answer = { result: new Promise(resolve => { ready = resolve }), cancel: jest.fn() }
  playback = { close: jest.fn(), cancel: jest.fn(), prepare: jest.fn((_, options) => options?.cache ? filler : answer), speak: jest.fn(async (text, onStart, ticket) => { onStart(); if (ticket === filler) await new Promise(resolve => { finishFiller = resolve }) }) }
  createMiraSpeechPlayback.mockReturnValue(playback)
  generateMiraDirectVoice.mockImplementation(async options => { options.onText('[confident] Your task is due today.'); return '[confident] Your task is due today.' })
})
afterEach(() => { jest.useRealTimers(); delete global.fetch })
test('fills the TTS wait and finishes the playing filler before starting the answer', async () => {
  const { result } = renderHook(() => useMiraVoice({ open: true }))
  await act(async () => result.current.start())
  let turn
  await act(async () => { turn = callbacks.onResult({ text: 'Check my task deadline' }); await Promise.resolve() })
  await act(async () => jest.advanceTimersByTimeAsync(700))
  expect(playback.speak.mock.calls[0][2]).toBe(filler)
  await act(async () => { ready({ response: {} }); await Promise.resolve() })
  expect(playback.speak).toHaveBeenCalledTimes(1)
  await act(async () => { finishFiller(); await turn })
  expect(filler.cancel).not.toHaveBeenCalled()
  expect(playback.speak.mock.calls[1][0]).toBe('[confident] Your task is due today.')
  expect(result.current.state).toBe('listening')
})
test('fast audio cancels the optional filler before it can speak', async () => {
  const { result } = renderHook(() => useMiraVoice({ open: true }))
  await act(async () => result.current.start())
  ready({ response: {} })
  await act(async () => callbacks.onResult({ text: 'Check my task deadline' }))
  await act(async () => jest.advanceTimersByTimeAsync(3000))
  expect(playback.speak).toHaveBeenCalledTimes(1)
  expect(playback.speak.mock.calls[0][0]).toBe('[confident] Your task is due today.')
})
test('goodbye while waiting cancels the filler and prevents late answer playback', async () => {
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
  expect(filler.cancel).toHaveBeenCalled()
  expect(playback.close).toHaveBeenCalledTimes(1)
  expect(playback.speak).toHaveBeenCalledTimes(1)
  expect(result.current.active).toBe(false)
})
