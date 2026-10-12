import { renderHook, act } from '@testing-library/react'
import useMiraAgentVoice from '@/hooks/useMiraAgentVoice'

const mockStartSession = jest.fn()
jest.mock('@elevenlabs/client', () => ({ Conversation: { startSession: (...args) => mockStartSession(...args) } }))
jest.mock('@/lib/miraListeningAudio', () => ({ createMiraListeningAudio: () => ({ close: jest.fn(), cancel: jest.fn(), play: jest.fn() }) }))
let options, end
beforeEach(() => {
  end = jest.fn(async () => {})
  localStorage.setItem('token', 'app-token')
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, conversationToken: 'rtc-token', bridgeCredential: 'voice-scoped-only', voiceId: 'voice' }) }))
  mockStartSession.mockImplementation(async config => { options = config; config.onConnect({ conversationId: 'one' }); return { endSession: end } })
})
test('does not acquire the microphone until explicitly started and keeps the app JWT away from the provider', async () => {
  const { result, unmount } = renderHook(() => useMiraAgentVoice({ open: true, sendMessage: jest.fn() }))
  expect(mockStartSession).not.toHaveBeenCalled()
  await act(async () => result.current.start())
  expect(options.connectionType).toBe('webrtc')
  expect(options.customLlmExtraBody).toEqual({ mira_bridge_credential: 'voice-scoped-only' })
  expect(JSON.stringify(options)).not.toContain('app-token')
  expect(result.current.state).toBe('listening')
  unmount(); expect(end).toHaveBeenCalledTimes(1)
})
test('calls the existing brain once and returns only its final speech for repeated tools', async () => {
  const sendMessage = jest.fn(async (_text, config) => { config.onSpeech('Task created.'); return 'Task created.' })
  const { result } = renderHook(() => useMiraAgentVoice({ open: true, sendMessage }))
  await act(async () => result.current.start())
  act(() => options.onMessage({ source: 'user', message: 'Create a task', event_id: 1 }))
  let replies
  await act(async () => { replies = await Promise.all([options.clientTools.ask_mira({ message: 'Create a task', utterance_id: 'one' }), options.clientTools.ask_mira({ message: 'Create a task', utterance_id: 'two' })]) })
  expect(sendMessage).toHaveBeenCalledTimes(1)
  expect(replies.map(JSON.parse)).toEqual([{ speech: 'Task created.' }, { speech: 'Task created.' }])
})
test('a closed session rejects late startup and never holds the microphone', async () => {
  let finish
  mockStartSession.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const { result } = renderHook(() => useMiraAgentVoice({ open: true, sendMessage: jest.fn() }))
  let starting
  await act(async () => { starting = result.current.start(); await Promise.resolve(); await Promise.resolve() })
  await act(async () => { while (!finish) await new Promise(resolve => setTimeout(resolve, 0)); result.current.stop(); finish({ endSession: end }); await starting })
  expect(end).toHaveBeenCalledTimes(1)
  expect(result.current.state).toBe('idle')
})
test('barge-in cancels current generation but never retries a previous write', async () => {
  const interruptResponse = jest.fn(), sendMessage = jest.fn()
  const { result } = renderHook(() => useMiraAgentVoice({ open: true, sendMessage, interruptResponse }))
  await act(async () => result.current.start())
  act(() => options.onInterruption({}))
  expect(interruptResponse).toHaveBeenCalledTimes(1)
  expect(sendMessage).not.toHaveBeenCalled()
})
afterEach(() => { jest.clearAllMocks(); localStorage.clear(); delete global.fetch })
