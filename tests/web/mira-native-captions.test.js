import React from 'react'
import { renderHook, act } from '@testing-library/react'
import { MiraChatProvider, useMiraChat } from '@/contexts/MiraChatContext'
jest.mock('@/lib/miraClientContext', () => ({ getMiraClientContext: () => ({}) }))
const wrapper = ({ children }) => <MiraChatProvider>{children}</MiraChatProvider>
beforeEach(() => {
  localStorage.setItem('token', 'local-app-token')
  global.fetch = jest.fn(async url => ({ ok: true, json: async () => url === '/api/ai/mira-chat/sessions' ? { success: true, session: { _id: 'native-session' } } : { success: true } }))
})
afterEach(() => { localStorage.clear(); delete global.fetch })
test('native captions persist a complete turn without chat generation or Thinking state', async () => {
  const { result } = renderHook(useMiraChat, { wrapper })
  await act(async () => result.current.recordVoiceMessage({ source: 'user', message: 'Hi' }))
  await act(async () => result.current.recordVoiceMessage({ source: 'ai', message: 'Hello!' }))
  expect(result.current.messages.map(m => [m.role, m.content])).toEqual([['user', 'Hi'], ['assistant', 'Hello!']])
  expect(result.current.messages.at(-1).data).toMatchObject({ message: 'Hello!', nativeVoice: true, cards: [], suggestedQuestions: [] })
  expect(result.current.isThinking).toBe(false)
  const calls = global.fetch.mock.calls
  expect(calls.some(([url]) => url === '/api/ai/mira-chat')).toBe(false)
  const saved = calls.find(([url, options]) => url.endsWith('/native-session') && options.method === 'PATCH')
  expect(JSON.parse(saved[1].body).messages.map(m => m.content)).toEqual(['Hi', 'Hello!'])
})
test('ending an interrupted native turn preserves the final user transcript', async () => {
  const { result } = renderHook(useMiraChat, { wrapper })
  await act(async () => result.current.recordVoiceMessage({ source: 'user', message: 'Hello there' }))
  await act(async () => result.current.recordVoiceMessage({ source: 'end' }))
  const saved = global.fetch.mock.calls.find(([url, options]) => url.endsWith('/native-session') && options.method === 'PATCH')
  expect(JSON.parse(saved[1].body).messages.map(m => m.content)).toEqual(['Hello there'])
})
test('tool handoff replaces the native user bubble rather than duplicating it', async () => {
  global.fetch.mockImplementation(async url => ({ ok: true, json: async () => url === '/api/ai/mira-chat'
    ? { success: true, response: { message: 'Verified result.' } } : { success: false } }))
  const { result } = renderHook(useMiraChat, { wrapper })
  await act(async () => result.current.recordVoiceMessage({ source: 'user', message: 'Show my tasks' }))
  act(() => result.current.recordVoiceMessage({ source: 'tool' }))
  await act(async () => result.current.sendMessage('Show my tasks', { inputMode: 'voice', voiceTool: true }))
  expect(result.current.messages.filter(m => m.role === 'user').map(m => m.content)).toEqual(['Show my tasks'])
  expect(result.current.messages.at(-1).content).toBe('Verified result.')
})
