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
test('call start has no captions or saves; completed captions are published afterward', async () => {
  const { result } = renderHook(useMiraChat, { wrapper })
  const target = result.current.recordVoiceMessage({ source: 'start' })
  expect(result.current.messages).toEqual([])
  expect(global.fetch).not.toHaveBeenCalled()
  await act(async () => result.current.recordVoiceMessage({ source: 'complete', target, messages: [{ source: 'user', message: 'Hi' }, { source: 'ai', message: 'Hello!' }] }))
  expect(result.current.messages.map(m => [m.role, m.content])).toEqual([['user', 'Hi'], ['assistant', 'Hello!']])
  expect(result.current.messages.at(-1).data).toMatchObject({ message: 'Hello!', nativeVoice: true, cards: [], suggestedQuestions: [] })
  expect(result.current.isThinking).toBe(false)
  const calls = global.fetch.mock.calls
  expect(calls.some(([url]) => url === '/api/ai/mira-chat')).toBe(false)
  const saved = calls.find(([url, options]) => url.endsWith('/native-session') && options.method === 'PATCH')
  expect(JSON.parse(saved[1].body).messages.map(m => m.content)).toEqual(['Hi', 'Hello!'])
})
test('post-call saves are bounded and keep saved tool turns from being duplicated', async () => {
  const { result } = renderHook(useMiraChat, { wrapper })
  const messages = Array.from({ length: 33 }, (_, i) => ({ source: i % 2 ? 'ai' : 'user', message: 'Message ' + i }))
  messages.push({ source: 'user', message: 'Already saved by tool', persisted: true })
  await act(async () => result.current.recordVoiceMessage({ source: 'complete', messages }))
  expect(result.current.messages).toHaveLength(33)
  const saves = global.fetch.mock.calls.filter(([url, options]) => url.endsWith('/native-session') && options.method === 'PATCH')
  expect(saves.map(([, options]) => JSON.parse(options.body).messages.length)).toEqual([30, 3])
})
test('changing chats cannot redirect a completed call transcript into the new conversation', async () => {
  const { result } = renderHook(useMiraChat, { wrapper })
  const target = result.current.recordVoiceMessage({ source: 'start' })
  act(() => result.current.startNewChat())
  await act(async () => result.current.recordVoiceMessage({ source: 'complete', target, messages: [{ source: 'user', message: 'Old call' }] }))
  expect(result.current.messages).toEqual([])
  expect(result.current.activeSessionId).toBeNull()
})
