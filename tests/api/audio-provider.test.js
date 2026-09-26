import { generateSpeech, transcribeAudio } from '@/lib/audio'
const originalEnv = process.env
beforeEach(() => { process.env = { ...originalEnv, ELEVENLABS_API_KEY: 'audio-test', ELEVENLABS_VOICE_ID: 'voice-test' }; global.fetch = jest.fn() })
afterEach(() => { process.env = originalEnv; jest.restoreAllMocks() })
test('call-alert TTS uses ElevenLabs, never Pollinations', async () => {
  fetch.mockResolvedValueOnce(new Response('audio'))
  expect((await generateSpeech('Hello')).success).toBe(true)
  expect(fetch.mock.calls[0][0]).toContain('api.elevenlabs.io/v1/text-to-speech/voice-test/stream')
  expect(fetch.mock.calls[0][1].headers['xi-api-key']).toBe('audio-test')
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ text: 'Hello' })
})
test('call-alert TTS uses MIRA default voice when no override is configured', async () => {
  delete process.env.ELEVENLABS_VOICE_ID
  fetch.mockResolvedValueOnce(new Response('audio'))
  expect((await generateSpeech('Hello')).success).toBe(true)
  expect(fetch.mock.calls[0][0]).toContain('api.elevenlabs.io/v1/text-to-speech/komDQG4wp0wC5IDFwetv/stream')
})
test('meeting uploads use native Scribe fields and return the detected language', async () => {
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ text: 'Hello', language_code: 'eng' })))
  const result = await transcribeAudio(new Blob(['audio'], { type: 'audio/webm' }))
  expect(result).toMatchObject({ success: true, text: 'Hello', languageCode: 'eng' })
  expect(fetch.mock.calls[0][0]).toBe('https://api.elevenlabs.io/v1/speech-to-text')
  expect(fetch.mock.calls[0][1].body.get('model_id')).toBe('scribe_v2')
})
