import { miraListeningWord } from './miraVoiceTurns'

export function createMiraListeningAudio() {
  const Context = window.AudioContext || window.webkitAudioContext
  let context = null
  // Optional backchannels must not block the SDK on browsers without Web Audio.
  try { if (Context) context = new Context() } catch {}
  context?.resume().catch(() => {})
  const clips = new Map(), abort = new AbortController()
  let source = null, closed = false, acknowledgements = 0
  const cancel = () => { try { source?.stop() } catch {} source = null }
  return {
    cancel,
    async play(voiceId, previousTranscript, stillListening) {
      if (!context || closed) return
      const text = miraListeningWord(previousTranscript, acknowledgements)
      let clip = clips.get(text)
      if (!clip) {
        clip = (async () => {
          const response = await fetch('/api/ai/mira-voice', { method: 'POST', signal: abort.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
            body: JSON.stringify({ text, voiceId }) })
          if (!response.ok) throw new Error('Acknowledgement unavailable')
          const bytes = await response.arrayBuffer()
          if (bytes.byteLength > 192000 || bytes.byteLength % 2) throw new Error('Invalid acknowledgement audio')
          const pcm = new DataView(bytes), buffer = context.createBuffer(1, bytes.byteLength / 2, 24000)
          const channel = buffer.getChannelData(0)
          for (let i = 0; i < channel.length; i++) channel[i] = pcm.getInt16(i * 2, true) / 32768
          return buffer
        })()
        clips.set(text, clip)
      }
      try {
        const buffer = await clip
        if (closed || !stillListening()) return
        cancel(); source = context.createBufferSource(); source.buffer = buffer
        source.connect(context.destination); source.start()
        acknowledgements++
      } catch { /* Backchannels are optional; never disrupt the primary voice call. */ }
    },
    close() { closed = true; abort.abort(); cancel(); clips.clear(); context?.close().catch(() => {}) },
  }
}
