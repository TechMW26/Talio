import { renderHook, act } from '@testing-library/react'
import useMiraAgentVoice from '@/hooks/useMiraAgentVoice'
import fs from 'node:fs'
import path from 'node:path'

const mockStart = jest.fn()
jest.mock('@elevenlabs/client', () => ({ Conversation: { startSession: (...args) => mockStart(...args) } }))
let options, call
beforeEach(() => {
  call = { endSession: jest.fn(async () => {}), getInputVolume: jest.fn(() => 0.3), getOutputVolume: jest.fn(() => 0.7) }
  localStorage.setItem('token', 'private-app-token')
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, conversationToken: 'rtc', bridgeCredential: 'scoped', tokensRemaining: 99 }) }))
  mockStart.mockImplementation(async config => { options = config; config.onConnect({}); return call })
})
afterEach(() => { localStorage.clear(); jest.clearAllMocks(); delete global.fetch })
test('ordinary native voice captions never start the chat brain; accounting is deduplicated', async () => {
  const sendMessage = jest.fn(), recordVoiceMessage = jest.fn(), onTokens = jest.fn()
  const { result } = renderHook(() => useMiraAgentVoice({ open: true, sendMessage, recordVoiceMessage, onTokens }))
  await act(async () => result.current.start())
  await act(async () => {
    options.onMessage({ source: 'user', message: 'Hello Mira', event_id: 1 })
    options.onMessage({ source: 'user', message: 'Hello Mira', event_id: 1 })
    options.onMessage({ source: 'ai', message: 'Hello! How can I help?' })
    options.onMessage({ source: 'ai', message: 'Hello! How can I help?' })
  })
  expect(sendMessage).not.toHaveBeenCalled()
  expect(recordVoiceMessage.mock.calls.map(([event]) => event.source)).toEqual(['user', 'ai'])
  expect(global.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/ai/mira-agent/session', '/api/ai/mira-agent/usage'])
  expect(options.customLlmExtraBody).toBeUndefined()
  expect(onTokens).toHaveBeenCalledWith(expect.objectContaining({ tokensRemaining: 99 }))
  expect(result.current.state).toBe('listening')
})
test('visualizer samples both real SDK levels and becomes silent after ending', async () => {
  const { result } = renderHook(() => useMiraAgentVoice({ open: true }))
  await act(async () => result.current.start())
  const getter = result.current.level
  expect(getter()).toBe(0.7)
  call.getInputVolume.mockReturnValue(0.9)
  expect(getter()).toBe(0.9)
  act(() => result.current.stop())
  expect(result.current.level).toBe(getter)
  expect(getter()).toBe(0)
  const sidebar = fs.readFileSync(path.join(process.cwd(), 'components/MiraChatSidebar.js'), 'utf8')
  expect(sidebar).toContain('level={voice.level}')
  expect(sidebar).toContain('isThinking && !voice.active')
})
test('punctuation-only ASR placeholders during silence never become captions or billable turns', async () => {
  const recordVoiceMessage = jest.fn(), sendMessage = jest.fn()
  const { result } = renderHook(() => useMiraAgentVoice({ open: true, recordVoiceMessage, sendMessage }))
  await act(async () => result.current.start())
  await act(async () => {
    options.onMessage({ source: 'user', message: '...', event_id: 1 })
    options.onMessage({ source: 'ai', message: '...' })
  })
  expect(global.fetch).toHaveBeenCalledTimes(1)
  expect(recordVoiceMessage).not.toHaveBeenCalled()
  expect(sendMessage).not.toHaveBeenCalled()
})
test('native tools use the accepted user instruction, not rewritten model parameters, exactly once', async () => {
  const sendMessage = jest.fn(async (_text, config) => { config.onSpeech('The screen is open.'); return 'The screen is open.' })
  const recordVoiceMessage = jest.fn()
  const { result } = renderHook(() => useMiraAgentVoice({ open: true, sendMessage, recordVoiceMessage }))
  await act(async () => result.current.start())
  await act(async () => options.onMessage({ source: 'user', message: 'Open my attendance page', event_id: 1 }))
  await act(async () => {
    await options.clientTools.ask_mira({ message: 'Invented destructive instruction', utterance_id: 'model-1' })
    await options.clientTools.ask_mira({ message: 'Another rewrite', utterance_id: 'model-2' })
    options.onMessage({ source: 'ai', message: 'The screen is open.' })
  })
  expect(sendMessage).toHaveBeenCalledTimes(1)
  expect(sendMessage).toHaveBeenCalledWith('Open my attendance page', expect.objectContaining({ voiceTool: true, inputMode: 'voice' }))
  expect(recordVoiceMessage.mock.calls.map(([event]) => event.source)).toEqual(['user', 'tool'])
})
test('failed quota authorization ends the call and cannot run a tool', async () => {
  const sendMessage = jest.fn()
  const { result } = renderHook(() => useMiraAgentVoice({ open: true, sendMessage }))
  await act(async () => result.current.start())
  global.fetch.mockImplementation(async () => ({ ok: false, json: async () => ({ success: false, message: 'Allowance exhausted' }) }))
  await act(async () => {
    options.onMessage({ source: 'user', message: 'Open my attendance page', event_id: 1 })
    await options.clientTools.ask_mira({ message: 'Open my attendance page', utterance_id: '1' })
  })
  expect(result.current.error).toBe('Allowance exhausted')
  expect(call.endSession).toHaveBeenCalledTimes(1)
  expect(sendMessage).not.toHaveBeenCalled()
})
