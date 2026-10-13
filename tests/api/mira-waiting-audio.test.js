import { createMiraSpeechPlayback } from '@/lib/miraSpeechPlayback'

const originalFetch = global.fetch
let context, language, voiceId
beforeEach(() => {
  language = 'en'; voiceId = 'voice-one'
  context = { resume: async () => {}, close: async () => {}, currentTime: 0,
    createBuffer: (_, length) => ({ duration: length / 24000, getChannelData: () => new Float32Array(length) }),
    createBufferSource: jest.fn(() => ({ connect() {}, disconnect() {}, stop: jest.fn(), start() {} })),
  }
  global.window = { AudioContext: function () { return context } }
  global.localStorage = { getItem: () => 'test-token' }
  global.fetch = jest.fn(async () => new Response(new Uint8Array([0, 0, 1, 0])))
})
afterEach(() => { global.fetch = originalFetch; delete global.window; delete global.localStorage })
test('generic PCM fillers cache only within this call and the exact voice/language', async () => {
  const playback = createMiraSpeechPlayback({ getPreferences: () => ({ voiceId, language }) })
  await playback.prepare('Let me check.', { cache: true }).result
  const cached = await playback.prepare('Let me check.', { cache: true }).result
  expect(await cached.response.arrayBuffer()).toHaveProperty('byteLength', 4)
  expect(fetch).toHaveBeenCalledTimes(1)
  language = 'hi'; await playback.prepare('Let me check.', { cache: true }).result
  voiceId = 'voice-two'; await playback.prepare('Let me check.', { cache: true }).result
  expect(fetch).toHaveBeenCalledTimes(3)
  playback.close()
  const next = createMiraSpeechPlayback({ getPreferences: () => ({ voiceId, language }) })
  await next.prepare('Let me check.', { cache: true }).result
  expect(fetch).toHaveBeenCalledTimes(4)
  next.close()
})
test('normal private responses are not put in the filler cache', async () => {
  const playback = createMiraSpeechPlayback()
  await playback.prepare('Private workplace result.').result
  await playback.prepare('Private workplace result.').result
  expect(fetch).toHaveBeenCalledTimes(2)
  playback.close()
})
test('cancelling a playing filler stops its scheduled audio and settles playback', async () => {
  const playback = createMiraSpeechPlayback()
  const ticket = playback.prepare('Let me check.', { cache: true })
  await ticket.result
  let started
  const ready = new Promise(resolve => { started = resolve })
  const playing = playback.speak('Let me check.', started, ticket)
  await ready
  ticket.cancel()
  await playing
  expect(context.createBufferSource.mock.results[0].value.stop).toHaveBeenCalledTimes(1)
  playback.close()
})
