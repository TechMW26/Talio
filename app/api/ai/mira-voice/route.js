import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { rateLimit } from '@/lib/security/rateLimiter'
import { splitMiraSpeech } from '@/lib/miraSpeechChunks'

export const runtime = 'nodejs'
export const maxDuration = 60

// A fixed provider/voice prevents clients from turning this into an open proxy.
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request)
    if (!auth.success) return NextResponse.json({ message: 'Authentication required' }, { status: auth.status || 401 })
    const { text } = await request.json()
    if (typeof text !== 'string' || !text.trim() || text.length > 5000) {
      return NextResponse.json({ message: 'Speech must contain 1–5000 characters.' }, { status: 400 })
    }
    const bucket = await rateLimit('MIRA_VOICE', `${auth.tenant.databaseName}:${auth.user._id}`)
    if (!bucket.allowed) return NextResponse.json({ message: 'Please wait before requesting more speech.' }, { status: 429, headers: { 'Retry-After': String(bucket.retryAfterSeconds) } })
    const key = process.env.ELEVENLABS_API_KEY
    const voice = process.env.ELEVENLABS_VOICE_ID
    if (!key || !voice) return NextResponse.json({ message: 'MIRA voice is not configured.' }, { status: 503 })
    const controller = new AbortController()
    const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(55000)])
    const chunks = splitMiraSpeech(text)
    const model = ['eleven_v3', 'eleven_flash_v2_5', 'eleven_multilingual_v2'].includes(process.env.MIRA_TTS_MODEL)
      ? process.env.MIRA_TTS_MODEL : 'eleven_v3'
    const hindi = /[\u0900-\u097f]/.test(text)
    const generate = chunk => fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=pcm_24000`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ text: chunk, model_id: model, apply_text_normalization: 'on',
        ...(hindi && model !== 'eleven_multilingual_v2' ? { language_code: 'hi' } : {}),
        voice_settings: { stability: model === 'eleven_v3' ? 0.5 : 0.45, similarity_boost: 0.75, use_speaker_boost: false } }),
    })
    const upstream = await generate(chunks[0])
    if (!upstream.ok || !upstream.body) return NextResponse.json({ message: 'Voice service is temporarily unavailable. Your reply is still in chat.' }, { status: 502 })
    let index = 0, reader = upstream.body.getReader()
    // At most one chunk ahead, preserving order without waiting for whole audio files.
    let pending = chunks[1] ? generate(chunks[1]).catch(() => null) : null
    const body = new ReadableStream({
      async pull(output) {
        try {
          const part = await reader.read()
          if (!part.done) { output.enqueue(part.value); return }
          reader.releaseLock()
          if (!pending) { output.close(); return }
          const next = await pending
          if (!next?.ok || !next.body) throw new Error('Speech stream interrupted')
          reader = next.body.getReader()
          index++
          pending = chunks[index + 1] ? generate(chunks[index + 1]).catch(() => null) : null
          const first = await reader.read()
          if (first.done) throw new Error('Empty speech chunk')
          output.enqueue(first.value)
        } catch (error) { controller.abort(); output.error(error) }
      },
      cancel() { controller.abort(); return reader.cancel().catch(() => {}) },
    })
    return new Response(body, { headers: { 'Content-Type': 'audio/pcm', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    return NextResponse.json({ message: 'Unable to generate speech.' }, { status: error instanceof SyntaxError ? 400 : 502 })
  }
}
