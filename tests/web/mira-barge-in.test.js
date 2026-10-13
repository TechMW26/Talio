import { act, renderHook } from '@testing-library/react'
import useMiraVoice from '@/hooks/useMiraVoice'
import { generateMiraDirectVoice } from '@/lib/miraDirectVoiceClient'
jest.mock('@/lib/miraDirectVoiceClient', () => ({ generateMiraDirectVoice: jest.fn() }))

let mockOptions
const mockCancel = jest.fn(), mockClose = jest.fn(), mockStop = jest.fn()
const mockSpeak = jest.fn()
jest.mock('@/lib/miraConversationRecognition', () => ({ startMiraConversationRecognition: async options => { mockOptions = options; return { stream: {}, stop: mockStop } } }))
jest.mock('@/lib/miraSpeechPlayback', () => ({ createMiraSpeechPlayback: () => ({ cancel: mockCancel, close: mockClose, speak: mockSpeak }) }))
beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ bridgeCredential: 'private', voiceId: 'selected', language: 'en' }) }))
  generateMiraDirectVoice.mockImplementation(async options => { options.onText('Your next meeting is at ten.'); return 'Your next meeting is at ten.' })
  mockSpeak.mockImplementation((text, onStart) => { onStart(); return new Promise(() => {}) })
})
afterEach(() => { delete global.fetch })
test('new speech interrupts playback, while echo does not', async () => {
  const sendMessage = jest.fn().mockResolvedValue('Your next meeting is at ten.')
  const { result, unmount } = renderHook(() => useMiraVoice({ open: true, busy: false, sendMessage }))
  await act(async () => { await result.current.start() })
  await act(async () => { void mockOptions.onResult({ text: 'What is next?' }); await Promise.resolve() })
  expect(result.current.state).toBe('speaking')
  act(() => mockOptions.onPartial('Your next meeting'))
  expect(mockCancel).not.toHaveBeenCalled()
  act(() => mockOptions.onPartial('wait a moment'))
  expect(mockCancel).toHaveBeenCalledTimes(1)
  expect(result.current.state).toBe('listening')
  await act(async () => { void mockOptions.onResult({ text: 'What about tomorrow?' }); await Promise.resolve() })
  expect(generateMiraDirectVoice.mock.calls.at(-1)[0].messages.at(-1).content).toBe('What about tomorrow?')
  unmount()
  expect(mockClose).toHaveBeenCalledTimes(1)
  expect(mockStop).toHaveBeenCalledTimes(1)
})
test('closing while awaiting MIRA prevents late playback', async () => {
  let resolve
  generateMiraDirectVoice.mockImplementation(() => new Promise(done => { resolve = done }))
  const sendMessage = jest.fn()
  const { result, rerender } = renderHook(({ open }) => useMiraVoice({ open, busy: false, sendMessage }), { initialProps: { open: true } })
  await act(async () => { await result.current.start() })
  await act(async () => { void mockOptions.onResult({ text: 'Hello' }); await Promise.resolve() })
  rerender({ open: false })
  await act(async () => resolve('Hello back'))
  expect(mockSpeak).not.toHaveBeenCalled()
  expect(result.current.active).toBe(false)
})
test('a final off command wins over echo matching and cancels active speech', async () => {
  generateMiraDirectVoice.mockImplementation(async options => { options.onText('You can say bye Mira.'); return 'You can say bye Mira.' })
  const onDismiss = jest.fn()
  const { result } = renderHook(() => useMiraVoice({ open: true, onDismiss }))
  await act(async () => result.current.start())
  await act(async () => { void mockOptions.onResult({ text: 'How do I close this call?' }); await Promise.resolve() })
  expect(result.current.state).toBe('speaking')
  await act(async () => mockOptions.onResult({ text: 'bye Mira' }))
  expect(onDismiss).toHaveBeenCalledTimes(1)
  expect(mockStop).toHaveBeenCalledTimes(1)
  expect(mockClose).toHaveBeenCalledTimes(1)
  expect(generateMiraDirectVoice).toHaveBeenCalledTimes(1)
})
test('barge-in retains the interrupted request in the bounded context window', async () => {
  generateMiraDirectVoice.mockImplementationOnce(() => new Promise(() => {}))
  const { result } = renderHook(() => useMiraVoice({ open: true, sendMessage: jest.fn() }))
  await act(async () => result.current.start())
  await act(async () => { void mockOptions.onResult({ text: 'What is on my schedule today?' }); await Promise.resolve() })
  act(() => mockOptions.onPartial('Actually tomorrow'))
  await act(async () => { void mockOptions.onResult({ text: 'Actually tomorrow' }); await Promise.resolve() })
  expect(generateMiraDirectVoice.mock.calls[1][0].messages).toEqual([
    { role: 'user', content: 'What is on my schedule today?' },
    { role: 'user', content: 'Actually tomorrow' },
  ])
})

test('ignores fuzzy echo and delayed final transcripts after playback without blocking new speech', async () => {
  let finish
  mockSpeak.mockImplementation((text, onStart) => { onStart(); return new Promise(resolve => { finish = resolve }) })
  const sendMessage = jest.fn().mockResolvedValue('Your next meeting is at ten.')
  const { result } = renderHook(() => useMiraVoice({ open: true, busy: false, sendMessage }))
  await act(async () => { await result.current.start() })
  let turn
  await act(async () => { turn = mockOptions.onResult({ text: 'What is next?' }); await Promise.resolve() })
  act(() => mockOptions.onPartial('Your next meetings at ten'))
  expect(mockCancel).not.toHaveBeenCalled()
  await act(async () => { finish(); await turn })
  expect(result.current.state).toBe('listening')
  await act(async () => { await mockOptions.onResult({ text: 'Your next meeting is at ten.' }) })
  expect(generateMiraDirectVoice).toHaveBeenCalledTimes(1)
  await act(async () => { void mockOptions.onResult({ text: 'What about tomorrow?' }); await Promise.resolve() })
  expect(generateMiraDirectVoice).toHaveBeenCalledTimes(2)
})
