// Synthetic live-provider transport acceptance; never opens a microphone,
// plays audio, executes actions, or claims audible-quality acceptance.
import fs from 'node:fs'
import { streamMiraAgentDeepSeek } from '@/lib/miraAgentGateway'
import { readMiraEvents } from '@/lib/miraStream'
import { createMiraStreamingSpeech } from '@/lib/miraStreamingSpeech'
import { DEFAULT_MIRA_VOICE_ID } from '@/lib/miraVoices'
const live = process.env.MIRA_VOICE_TRANSPORT_LIVE === '1' ? test : test.skip
const evidence = []
afterAll(() => {
  if (process.env.MIRA_VOICE_TRANSPORT_LIVE === '1') fs.writeFileSync('/tmp/mira-voice-transport.json', JSON.stringify(evidence, null, 2))
})
live.each([
  ['en', 'What is a rainbow? Give one short sentence.'],
  ['hi', 'इंद्रधनुष क्या है? एक छोटे वाक्य में बताओ।'],
])('live %s generation to V4 PCM transport', async (language, prompt) => {
  require('dotenv').config({ path: '.env.local', quiet: true })
  if (!process.env.DEEPSEEK_API_KEY || !process.env.ELEVENLABS_API_KEY) throw new Error('Live providers not configured')
  const started = performance.now(), signal = AbortSignal.timeout(55000)
  const elapsed = () => Math.round(performance.now() - started)
  const record = { language, prompt, voice: DEFAULT_MIRA_VOICE_ID, model: 'eleven_v4', bytes: 0, nonzero: false, passed: false }
  evidence.push(record)
  const speech = createMiraStreamingSpeech({
    live: () => !signal.aborted,
    prepare: phrase => ({ response: fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(DEFAULT_MIRA_VOICE_ID)}/stream?output_format=pcm_24000`, {
      method: 'POST', signal,
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: phrase, model_id: 'eleven_v4', language_code: language, apply_text_normalization: 'auto', voice_settings: { stability: 0.4, similarity_boost: 0.75 } }),
    }).then(response => ({ response }), () => ({ error: true })), cancel() {} }),
    speak: async (phrase, ticket) => {
      const result = await ticket.response
      if (result.error || !result.response?.ok || !result.response.body) throw new Error('Live synthesis failed')
      const reader = result.response.body.getReader()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (!value.length) continue
        record.firstAudioMs ??= elapsed()
        record.bytes += value.length
        record.nonzero ||= value.some(byte => byte !== 0)
      }
    },
  })
  let text = '', finished = false
  const body = await streamMiraAgentDeepSeek({ messages: [{ role: 'user', content: prompt }], tools: [] }, { language, direct: true, signal })
  await readMiraEvents(body, event => {
    const choice = event.choices?.[0]
    if (choice?.delta?.reasoning_content) throw new Error('Private reasoning reached transport')
    if (choice?.delta?.content) {
      record.firstTextMs ??= elapsed()
      text += choice.delta.content
      speech.update(text)
    }
    if (choice?.finish_reason === 'stop') finished = true
  })
  record.generationFinishedMs = elapsed()
  await speech.finish(text)
  record.totalMs = elapsed()
  record.text = text
  expect(finished).toBe(true)
  expect(text).toMatch(language === 'hi' ? /[\u0900-\u097f]/u : /rainbow|sunlight|raindrop|light/i)
  expect(record.bytes).toBeGreaterThan(4800)
  expect(record.bytes % 2).toBe(0)
  expect(record.nonzero).toBe(true)
  record.passed = true
}, 60000)
