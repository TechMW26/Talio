import React from 'react'
import { renderHook, act } from '@testing-library/react'
import { MiraChatProvider, useMiraChat } from '@/contexts/MiraChatContext'
import { ReadableStream } from 'stream/web'
import { TextEncoder, TextDecoder } from 'util'
jest.mock('@/lib/miraClientContext', () => ({ getMiraClientContext: () => ({}) }))
global.TextDecoder = TextDecoder
const wrapper = ({ children }) => <MiraChatProvider>{children}</MiraChatProvider>
const bytes = value => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)

test('navigation prerequisites continue with executor evidence and the original request', async () => {
  window.history.replaceState({}, '', '/dashboard')
  const navigate = event => window.history.replaceState({}, '', event.detail.page)
  window.addEventListener('mira:navigate', navigate)
  let chats = 0
  const requests = []
  global.fetch = jest.fn(async (url, options) => ({ ok: true, json: async () => {
    if (url === '/api/ai/mira-chat') {
      requests.push(JSON.parse(options.body))
      return { success: true, response: ++chats === 1
        ? { message: 'Opening Assets.', action: { type: 'navigate', page: '/dashboard/assets' }, continueUi: true }
        : { message: 'Assets is open. Add Asset is in the page header.' } }
    }
    return { success: false }
  } }))
  try {
    const { result } = renderHook(useMiraChat, { wrapper })
    await act(async () => { await result.current.sendMessage('Open Assets and show me where to add one') })
    expect(chats).toBe(2)
    expect(requests[1].message).toBe(requests[0].message)
    expect(requests[1].conversationHistory.some(m => m.content.includes('Requested page opened.'))).toBe(true)
    expect(result.current.isThinking).toBe(false)
  } finally {
    window.removeEventListener('mira:navigate', navigate)
    window.history.replaceState({}, '', '/')
  }
})

test.each([true, false])('queue automatically continues only after verified success (%s)', async success => {
  const lookup = { type: 'lookup_people', fields: { query: 'Sahil' } }
  const send = { type: 'send_message', fields: { recipient: 'Sahil', content: 'Hello' } }
  let chats = 0
  global.fetch = jest.fn(async url => ({ ok: true, json: async () => {
    if (url === '/api/ai/mira-chat') return { success: true, response: ++chats === 1
      ? { message: 'Looking up Sahil.', action: lookup, taskPlan: [{ request: 'Find Sahil', action: lookup }, { request: 'Send Hello to Sahil', action: send }] }
      : { message: 'Sending.', action: send } }
    if (url === '/api/ai/mira-actions') return { success, message: success ? 'Completed.' : 'Choose which Sahil.' }
    return { success: false }
  } }))
  const { result } = renderHook(useMiraChat, { wrapper })
  await act(async () => { await result.current.sendMessage('Find Sahil and send Hello to him') })
  expect(fetch.mock.calls.filter(([url]) => url === '/api/ai/mira-actions')).toHaveLength(success ? 2 : 1)
  expect(result.current.messages.filter(m => m.role === 'user')).toHaveLength(1)
  expect(result.current.messages.filter(m => m.role === 'assistant')).toHaveLength(success ? 2 : 1)
  expect(result.current.messages.at(-1).data.taskBank.tasks.map(t => t.status)).toEqual(success ? ['completed', 'completed'] : ['blocked', 'pending'])
  expect(result.current.messages.some(m => /say next|confirm this is done/i.test(m.content))).toBe(false)
  expect(result.current.isThinking).toBe(false)
})

test('closing MIRA stops automatic queue continuation', async () => {
  const action = { type: 'lookup_people', fields: { query: 'Sahil' } }
  global.fetch = jest.fn(async url => ({ ok: true, json: async () => {
    if (url === '/api/ai/mira-chat') return { success: true, response: { message: '', action, taskPlan: [{ request: 'Find Sahil', action }, { request: 'Find Rahul', action: { ...action, fields: { query: 'Rahul' } } }] } }
    if (url === '/api/ai/mira-actions') return { success: true, message: 'Found Sahil.' }
    return { success: false }
  } }))
  const { result } = renderHook(useMiraChat, { wrapper })
  await act(async () => { await result.current.sendMessage('Find Sahil and Rahul', { onResponse: () => result.current.closeChat() }) })
  expect(fetch.mock.calls.filter(([url]) => url === '/api/ai/mira-actions')).toHaveLength(1)
  expect(result.current.messages.at(-1).content).toBe('Found Sahil.')
  expect(result.current.isThinking).toBe(false)
})

test('completed replies release thinking while ordered session creation is still pending', async () => {
  let finishCreate
  global.fetch = jest.fn(async url => {
    if (url === '/api/ai/mira-chat') return { json: async () => ({ success: true, response: { message: 'Done.' } }) }
    if (url === '/api/ai/mira-chat/sessions') return new Promise(resolve => { finishCreate = () => resolve({ json: async () => ({ success: true, session: { _id: 'session-one' } }) }) })
    return { ok: true, json: async () => ({ success: true }) }
  })
  const { result } = renderHook(useMiraChat, { wrapper })
  await act(async () => { await result.current.sendMessage('First question') })
  expect(result.current.isThinking).toBe(false)
  expect(result.current.messages.at(-1).content).toBe('Done.')
  await act(async () => { await result.current.sendMessage('Second question') })
  expect(fetch.mock.calls.filter(([url]) => url === '/api/ai/mira-chat')).toHaveLength(2)
  expect(fetch.mock.calls.filter(([url]) => url === '/api/ai/mira-chat/sessions')).toHaveLength(1)
  await act(async () => { finishCreate(); await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(fetch.mock.calls.filter(([url]) => url === '/api/ai/mira-chat/sessions/session-one')).toHaveLength(2)
  expect(result.current.activeSessionId).toBe('session-one')
})

test('a delayed save cannot attach an old session to a new chat', async () => {
  let finishCreate
  global.fetch = jest.fn(async url => {
    if (url === '/api/ai/mira-chat') return { json: async () => ({ success: true, response: { message: 'Saved later.' } }) }
    if (url === '/api/ai/mira-chat/sessions') return new Promise(resolve => { finishCreate = () => resolve({ json: async () => ({ success: true, session: { _id: 'old-session' } }) }) })
    return { ok: true, json: async () => ({ success: true }) }
  })
  const { result } = renderHook(useMiraChat, { wrapper })
  await act(async () => { await result.current.sendMessage('First chat') })
  await act(async () => { await result.current.startNewChat() })
  await act(async () => { finishCreate(); await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(result.current.activeSessionId).toBeNull()
  expect(result.current.messages).toEqual([])
  expect(fetch.mock.calls.some(([url]) => url === '/api/ai/mira-chat/sessions/old-session')).toBe(true)
})

test('generates an image once and preserves its ID in the assistant message', async () => {
  global.fetch = jest.fn(async url => ({ ok: true, json: async () => {
    if (url === '/api/ai/mira-chat') return { success: true, response: { message: 'Creating your image.', action: { type: 'generate_image', fields: { prompt: 'A blue bird' } } } }
    if (url === '/api/ai/mira-images') return { success: true, image: { id: '1234567890abcdef12345678', status: 'ready' } }
    return { success: false }
  } }))
  const { result, rerender } = renderHook(useMiraChat, { wrapper })
  await act(async () => { await result.current.sendMessage('Generate a blue bird image') })
  expect(result.current.messages.at(-1).data.image).toEqual({ id: '1234567890abcdef12345678', status: 'ready' })
  expect(result.current.messages.at(-1).content).toBe('Your image is ready.')
  rerender()
  expect(fetch.mock.calls.filter(([url]) => url === '/api/ai/mira-images')).toHaveLength(1)
  expect(fetch.mock.calls.filter(([url]) => url === '/api/ai/mira-actions')).toHaveLength(0)
})

test.each(['chat', 'pip', 'expanded'])('goodbye emits dismiss and closes %s without a model request', async mode => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) })
  const { result } = renderHook(useMiraChat, { wrapper })
  await act(async () => { result.current.openChat() })
  act(() => { result.current.setViewMode(mode) })
  fetch.mockClear()
  await act(async () => { await result.current.sendMessage('ठीक है, मेरा। Done, done. बस, ठीक है। Bye, bye.') })
  expect(result.current.isOpen).toBe(false)
  expect(result.current.messages.at(-1).data.action).toEqual({ type: 'dismiss' })
  expect(fetch).not.toHaveBeenCalled()
})

test('goodbye aborts an in-flight answer without losing the dismiss response', async () => {
  let requestSignal
  global.fetch = jest.fn((url, options) => {
    if (url !== '/api/ai/mira-chat') return Promise.resolve({ ok: true, json: async () => ({ success: false }) })
    requestSignal = options.signal
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
  })
  const { result } = renderHook(useMiraChat, { wrapper })
  await act(async () => { result.current.openChat() })
  let pending
  act(() => { pending = result.current.sendMessage('Explain my dashboard') })
  expect(result.current.isThinking).toBe(true)
  await act(async () => { await result.current.sendMessage('Okay, done, bye bye'); await pending })
  expect(requestSignal.aborted).toBe(true)
  expect(result.current.isOpen).toBe(false)
  expect(result.current.isThinking).toBe(false)
  expect(result.current.messages.at(-1).data.action.type).toBe('dismiss')
})

test('updates one bubble incrementally then replaces it with final validated data', async () => {
  const onPartialResponse = jest.fn()
  let controller
  const body = new ReadableStream({ start(value) { controller = value } })
  global.fetch = jest.fn().mockResolvedValueOnce({ headers: { get: () => 'text/event-stream' }, body })
    .mockResolvedValue({ ok: true, json: async () => ({ success: false }) })
  const { result } = renderHook(useMiraChat, { wrapper })
  let pending
  act(() => { pending = result.current.sendMessage('Hello', { onPartialResponse }) })
  await act(async () => { controller.enqueue(bytes({ type: 'message', message: 'Hi' })); await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(result.current.messages).toHaveLength(2)
  expect(result.current.messages[1]).toMatchObject({ content: 'Hi', streaming: true })
  expect(result.current.isThinking).toBe(true)
  expect(onPartialResponse).toHaveBeenCalledWith('Hi')
  await act(async () => {
    controller.enqueue(bytes({ type: 'complete', success: true, response: { message: 'Hi there!', cards: [], suggestedQuestions: [] } }))
    controller.close()
    await pending
  })
  expect(result.current.messages).toHaveLength(2)
  expect(result.current.messages[1].content).toBe('Hi there!')
  expect(result.current.messages[1].streaming).toBeUndefined()
  expect(result.current.isThinking).toBe(false)
  expect(JSON.parse(fetch.mock.calls[0][1].body).stream).toBe(true)
})

test('a truncated stream removes partial output and shows a retryable error', async () => {
  global.fetch = jest.fn().mockResolvedValue({ headers: { get: () => 'text/event-stream' }, body: new ReadableStream({ start(controller) {
    controller.enqueue(bytes({ type: 'message', message: 'Incomplete' })); controller.close()
  } }) })
  const { result } = renderHook(useMiraChat, { wrapper })
  await act(async () => { await result.current.sendMessage('Hello') })
  expect(result.current.messages.some(m => m.streaming || m.content === 'Incomplete')).toBe(false)
  expect(result.current.messages.at(-1).content).toContain('try again')
  expect(result.current.isThinking).toBe(false)
})

test('executes a fresh requested action once and records its real outcome in follow-up context', async () => {
  let chats = 0
  global.fetch = jest.fn(async url => ({ ok: true, json: async () => {
    if (url === '/api/ai/mira-chat') return { success: true, response: ++chats === 1
      ? { message: 'Sending.', action: { type: 'send_message', fields: { recipient: 'Sahil', content: 'Hello' } } }
      : { message: 'It was sent.' } }
    if (url === '/api/ai/mira-actions') return { success: true, message: 'Message sent successfully.' }
    return { success: false }
  } }))
  const { result, rerender } = renderHook(useMiraChat, { wrapper })
  await act(async () => { await result.current.sendMessage('Send Hello to Sahil') })
  expect(result.current.messages.at(-1).data.actionResult.success).toBe(true)
  expect(result.current.messages.at(-1).content).toBe('Message sent successfully.')
  rerender()
  await act(async () => { await result.current.sendMessage('Did you send it?') })
  expect(fetch.mock.calls.filter(([url]) => url === '/api/ai/mira-actions')).toHaveLength(1)
  const lastChat = fetch.mock.calls.filter(([url]) => url === '/api/ai/mira-chat').at(-1)
  expect(JSON.parse(lastChat[1].body).conversationHistory.at(-1).content).toContain('"success":true')
})

test('person selection resumes the original action without regenerating its content', async () => {
  const person = { value: 'employee:bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Sahil Sahu', code: 'U22', department: 'Tech' }
  let attempts = 0
  global.fetch = jest.fn(async url => ({ ok: true, json: async () => {
    if (url === '/api/ai/mira-chat') return { success: true, response: { message: 'Sending.', action: { type: 'send_message', fields: { recipient: 'साहिल', content: 'Hello' } } } }
    if (url === '/api/ai/mira-actions') return ++attempts === 1
      ? { success: false, message: 'Choose a person.', resolution: { field: 'recipient', query: 'साहिल', candidates: [person] } }
      : { success: true, message: 'Sent.' }
    return { success: false }
  } }))
  const { result } = renderHook(useMiraChat, { wrapper })
  await act(async () => { await result.current.sendMessage('Send Hello to साहिल') })
  const id = result.current.messages.at(-1).id
  await act(async () => { await result.current.sendMessage('Choose Sahil Sahu.', { resolvePerson: { messageId: id, value: person.value } }) })
  expect(fetch.mock.calls.filter(([url]) => url === '/api/ai/mira-chat')).toHaveLength(1)
  const request = fetch.mock.calls.filter(([url]) => url === '/api/ai/mira-actions').at(-1)
  expect(JSON.parse(request[1].body).action.fields).toEqual({ recipient: person.value, content: 'Hello' })
  expect(result.current.messages.at(-1).content).toBe('Sent.')
  await act(async () => { await result.current.sendMessage('Choose again', { resolvePerson: { messageId: id, value: person.value } }) })
  expect(attempts).toBe(2)
})
