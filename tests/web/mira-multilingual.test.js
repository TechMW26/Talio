import { waitFor } from '@testing-library/react'
import { startMiraConversationRecognition } from '@/lib/miraConversationRecognition'

let socket, processor, track, context
beforeEach(() => {
  localStorage.setItem('token', 'test-session')
  socket = null
  track = { stop: jest.fn(), addEventListener: jest.fn() }
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] }) } })
  window.AudioContext = function () {
    context = { sampleRate: 16000, state: 'running', resume: async () => {}, close: jest.fn().mockResolvedValue(), audioWorklet: { addModule: jest.fn(async () => {}) }, createMediaStreamSource: () => ({ connect: jest.fn(), disconnect: jest.fn() }) }
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
  expect(context.audioWorklet.addModule).toHaveBeenCalledWith('/audio/mira-capture-worklet.js')
  expect(fetch).toHaveBeenCalled()
  abort.abort()
  resolve({ getTracks: () => [track] })
  await expect(pending).rejects.toHaveProperty('name', 'AbortError')
  expect(track.stop).toHaveBeenCalled()
  expect(socket).toBeNull()
})

test('voice streams and cleans up in runtimes without audioWorklet', async () => {
  const OriginalContext = window.AudioContext
  window.AudioContext = function () {
    const value = new OriginalContext()
    delete value.audioWorklet
    value.createScriptProcessor = jest.fn(() => {
      processor = { connect: jest.fn(), disconnect: jest.fn() }
      return processor
    })
    return value
  }
  const pending = startMiraConversationRecognition({ onResult: jest.fn(), onError: jest.fn() })
  await waitFor(() => expect(socket).not.toBeNull())
  socket.onmessage({ data: JSON.stringify({ message_type: 'session_started' }) })
  const engine = await pending
  const output = new Float32Array([1, 1])
  processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array([.1, -.1]) }, outputBuffer: { getChannelData: () => output } })
  expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ message_type: 'input_audio_chunk', sample_rate: 16000 })
  expect([...output]).toEqual([0, 0])
  engine.stop()
  expect(processor.onaudioprocess).toBeNull()
  expect(track.stop).toHaveBeenCalled()
  expect(socket.close).toHaveBeenCalled()
})
