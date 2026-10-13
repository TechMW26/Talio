import { createMiraVoiceEchoGuard } from '@/lib/miraVoiceEcho'
import { act, renderHook } from '@testing-library/react'
import useMiraAgentVoice from '@/hooks/useMiraAgentVoice'

const mockStart = jest.fn()
jest.mock('@elevenlabs/client', () => ({ Conversation: { startSession: (...args) => mockStart(...args) } }))
test('filters playback and late echoed tool retries, but keeps different speech and short barge-in', () => {
  const guard = createMiraVoiceEchoGuard()
  guard.remember('Your project has been created. Three tasks are pending.')
  guard.mode('speaking', 1000)
  expect(guard.reject('Your project has been created!', 1100)).toBe(true)
  expect(guard.reject('Three tasks are pending.', 1200)).toBe(true)
  expect(guard.reject('Stop', 1200)).toBe(false)
  expect(guard.reject('No, create a different project', 1300)).toBe(false)
  guard.mode('listening', 1400)
  expect(guard.reject('Your project has been created', 3500, true)).toBe(true)
  expect(guard.reject('Your project has been created', 3600)).toBe(false)
  expect(guard.reject('Three tasks are pending', 10000)).toBe(false)
})
test('does not filter a matching utterance before playback or once the tail expires', () => {
  const guard = createMiraVoiceEchoGuard()
  guard.remember('हाँ आपकी आवाज़ आ रही है।')
  expect(guard.reject('हाँ आपकी आवाज़ आ रही है', 1)).toBe(false)
  guard.mode('speaking', 2)
  expect(guard.reject('हाँ आपकी आवाज़ आ रही है।', 3)).toBe(true)
  guard.mode('listening', 4)
  expect(guard.reject('क्या आप मेरी आवाज़ सुन सकती हैं', 1000)).toBe(false)
})
test('WebRTC keeps one connected call, ignores echoed playback and never requests separate filler audio', async () => {
  const originalFetch = global.fetch
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, conversationToken: 'rtc-token', voiceId: 'voice' }) }))
  let options
  const endSession = jest.fn(async () => {}), sendMessage = jest.fn(async () => 'Your project has been created.')
  mockStart.mockImplementation(async config => { options = config; config.onConnect({}); return { endSession } })
  const { result, unmount } = renderHook(() => useMiraAgentVoice({ open: true, sendMessage }))
  try {
    await act(async () => result.current.start())
    expect(options).toMatchObject({ connectionType: 'webrtc', conversationToken: 'rtc-token' })
    expect(options.signedUrl).toBeUndefined()
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ transport: 'webrtc' })
    act(() => options.onMessage({ source: 'user', message: 'Create a project', event_id: 1 }))
    await act(async () => options.clientTools.ask_mira({ message: 'Create a project', utterance_id: 'first' }))
    act(() => {
      options.onMessage({ source: 'ai', message: 'Your project has been created.' })
      options.onModeChange({ mode: 'speaking' })
      options.onMessage({ source: 'user', message: 'Your project has been created.', event_id: 2 })
    })
    let reply
    await act(async () => { reply = await options.clientTools.ask_mira({ message: 'Your project has been created.', utterance_id: 'echo' }) })
    expect(JSON.parse(reply)).toEqual({ speech: '' })
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(options.onVadScore).toBeUndefined()
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(global.fetch.mock.calls[1][0]).toBe('/api/ai/mira-agent/usage')
    expect(endSession).not.toHaveBeenCalled()
    expect(mockStart).toHaveBeenCalledTimes(1)
  } finally { unmount(); global.fetch = originalFetch; jest.clearAllMocks() }
})
