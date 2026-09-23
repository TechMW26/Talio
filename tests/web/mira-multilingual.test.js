import { waitFor } from '@testing-library/react'
import { startMiraConversationRecognition } from '@/lib/miraConversationRecognition'

let socket, processor, track, context
beforeEach(() => {
  localStorage.setItem('token', 'test-session')
  socket = null
  track = { stop: jest.fn(), addEventListener: jest.fn() }
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] }) } })
  window.AudioContext = function () {
    context = { sampleRate: 16000, state: 'running', resume: async () => {}, close: jest.fn().mockResolvedValue(), audioWorklet: { addModule: async () => {} }, createMediaStreamSource: () => ({ connect: jest.fn(), disconnect: jest.fn() }) }
    return context
  }
  window.AudioWorkletNode = function () { processor = { port: { close: jest.fn() }, connect: jest.fn(), disconnect: jest.fn() }; return processor }
  window.WebSocket = class {
    static OPEN = 1
    constructor(url) { this.url = url; this.readyState = 1; this.bufferedAmount = 0; this.close = jest.fn(); this.send = jest.fn(); socket = this }
  }
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'single-use-test' }) })
})
test('auto-detects language and forwards Hindi and English transcripts without duplicates', async () => {
  const onResult = jest.fn(), onPartial = jest.fn()
  const pending = startMiraConversationRecognition({ onResult, onPartial, onError: jest.fn() })
  await waitFor(() => expect(socket).not.toBeNull())
  expect(new URL(socket.url).searchParams.has('language_code')).toBe(false)
  socket.onmessage({ data: JSON.stringify({ message_type: 'session_started' }) })
  const engine = await pending
  socket.onmessage({ data: JSON.stringify({ message_type: 'partial_transcript', text: 'मेरी' }) })
  socket.onmessage({ data: JSON.stringify({ message_type: 'committed_transcript', text: 'मेरी attendance बताओ' }) })
  socket.onmessage({ data: JSON.stringify({ message_type: 'committed_transcript_with_timestamps', text: 'मेरी attendance बताओ' }) })
  expect(onPartial).toHaveBeenCalledWith('मेरी')
  expect(onResult).toHaveBeenCalledTimes(1)
  expect(onResult).toHaveBeenCalledWith({ text: 'मेरी attendance बताओ' })
  processor.port.onmessage({ data: new Float32Array([0, 0.5, -0.5]) })
  expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ message_type: 'input_audio_chunk', sample_rate: 16000 })
  engine.stop()
  expect(track.stop).toHaveBeenCalled()
  expect(socket.close).toHaveBeenCalled()
  expect(context.close).toHaveBeenCalled()
})
test('permission resolving after cancellation releases the microphone without connecting', async () => {
  let resolve
  navigator.mediaDevices.getUserMedia.mockImplementation(() => new Promise(done => { resolve = done }))
  const abort = new AbortController()
  const pending = startMiraConversationRecognition({ signal: abort.signal })
  await waitFor(() => expect(resolve).toBeDefined())
  abort.abort()
  resolve({ getTracks: () => [track] })
  await expect(pending).rejects.toHaveProperty('name', 'AbortError')
  expect(track.stop).toHaveBeenCalled()
  expect(socket).toBeNull()
})
