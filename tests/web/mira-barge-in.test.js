import { act, renderHook } from '@testing-library/react'
import useMiraVoice from '@/hooks/useMiraVoice'

let mockOptions
const mockCancel = jest.fn(), mockClose = jest.fn(), mockStop = jest.fn()
const mockSpeak = jest.fn()
jest.mock('@/lib/miraConversationRecognition', () => ({ startMiraConversationRecognition: async options => { mockOptions = options; return { stream: {}, stop: mockStop } } }))
jest.mock('@/lib/miraSpeechPlayback', () => ({ createMiraSpeechPlayback: () => ({ cancel: mockCancel, close: mockClose, speak: mockSpeak }) }))
beforeEach(() => { jest.clearAllMocks(); mockSpeak.mockImplementation((text, onStart) => { onStart(); return new Promise(() => {}) }) })
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
  expect(sendMessage).toHaveBeenLastCalledWith('What about tomorrow?', expect.objectContaining({ onResponse: expect.any(Function) }))
  unmount()
  expect(mockClose).toHaveBeenCalledTimes(1)
  expect(mockStop).toHaveBeenCalledTimes(1)
})
test('closing while awaiting MIRA prevents late playback', async () => {
  let resolve
  const sendMessage = () => new Promise(done => { resolve = done })
  const { result, rerender } = renderHook(({ open }) => useMiraVoice({ open, busy: false, sendMessage }), { initialProps: { open: true } })
  await act(async () => { await result.current.start() })
  act(() => { void mockOptions.onResult({ text: 'Hello' }) })
  rerender({ open: false })
  await act(async () => resolve('Hello back'))
  expect(mockSpeak).not.toHaveBeenCalled()
  expect(result.current.active).toBe(false)
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
  expect(sendMessage).toHaveBeenCalledTimes(1)
  await act(async () => { void mockOptions.onResult({ text: 'What about tomorrow?' }); await Promise.resolve() })
  expect(sendMessage).toHaveBeenCalledTimes(2)
})
