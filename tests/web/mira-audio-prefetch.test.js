import { createMiraSpeechPlayback } from '@/lib/miraSpeechPlayback'

let context
beforeEach(() => {
  context = {
    resume: jest.fn().mockResolvedValue(), close: jest.fn().mockResolvedValue(), currentTime: 0,
    createBuffer: jest.fn((_, length) => ({ duration: length / 24000, getChannelData: () => new Float32Array(length) })),
    createBufferSource: jest.fn(() => {
      const source = { connect: jest.fn(), disconnect: jest.fn(), stop: jest.fn(), start: () => queueMicrotask(() => source.onended?.()) }
      return source
    }),
  }
  window.AudioContext = jest.fn(() => context)
  global.fetch = jest.fn()
})
afterEach(() => { delete window.AudioContext; delete global.fetch })

function audio() {
  const reader = { read: jest.fn().mockResolvedValueOnce({ value: new Uint8Array([0, 0, 1, 0]), done: false }).mockResolvedValue({ done: true }), cancel: jest.fn().mockResolvedValue(), releaseLock: jest.fn() }
  return { ok: true, body: { getReader: () => reader, cancel: jest.fn().mockResolvedValue() } }
}

test('acquires ahead of playback and reuses the prepared stream without a second request', async () => {
  fetch.mockResolvedValue(audio())
  const playback = createMiraSpeechPlayback()
  const ticket = playback.prepare('Hello there.')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(context.createBufferSource).not.toHaveBeenCalled()
  const onStart = jest.fn()
  await playback.speak('Hello there.', onStart, ticket)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(onStart).toHaveBeenCalledTimes(1)
  playback.close()
})

test('interrupting cancels prefetched response bodies and prevents stale playback', async () => {
  const response = audio()
  fetch.mockResolvedValue(response)
  const playback = createMiraSpeechPlayback()
  const ticket = playback.prepare('Old reply.')
  await ticket.result
  playback.cancel()
  await playback.speak('Old reply.', jest.fn(), ticket)
  expect(response.body.cancel).toHaveBeenCalled()
  expect(context.createBufferSource).not.toHaveBeenCalled()
  playback.close()
})

test('a failed prefetch is handled until playback consumes the error', async () => {
  fetch.mockResolvedValue({ ok: false, status: 401 })
  const playback = createMiraSpeechPlayback()
  const ticket = playback.prepare('Hello.')
  expect((await ticket.result).error).toBeInstanceOf(Error)
  await expect(playback.speak('Hello.', jest.fn(), ticket)).rejects.toThrow('unavailable')
  expect(fetch).toHaveBeenCalledTimes(1)
  playback.close()
})
