// Stream signed 16-bit PCM directly into Web Audio. No full-file download delay.
export function createMiraSpeechPlayback() {
  const context = new (window.AudioContext || window.webkitAudioContext)()
  const ready = context.resume()
  const sources = new Set()
  let controller, disposed = false
  function cancel() {
    controller?.abort()
    for (const source of sources) { source.onended = null; source.stop(); source.disconnect() }
    sources.clear()
  }
  return {
    cancel,
    close() { disposed = true; cancel(); context.close().catch(() => {}) },
    async speak(text, onStart) {
      cancel()
      const own = new AbortController()
      controller = own
      await ready
      if (disposed || own.signal.aborted) return
      const token = localStorage.getItem('token') || document.cookie.match(/token=([^;]+)/)?.[1] || ''
      const response = await fetch('/api/ai/mira-voice', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ text: text.slice(0, 5000) }), signal: own.signal })
      if (!response.ok) throw new Error((await response.json()).message || 'Voice playback unavailable.')
      const reader = response.body.getReader()
      let tail = new Uint8Array(0), next = context.currentTime, started = false, last
      try {
        while (!own.signal.aborted) {
          const { value, done } = await reader.read()
          if (done) break
          if (own.signal.aborted) break
          const bytes = new Uint8Array(tail.length + value.length)
          bytes.set(tail); bytes.set(value, tail.length)
          const length = bytes.length - bytes.length % 2
          tail = bytes.slice(length)
          if (!length) continue
          const buffer = context.createBuffer(1, length / 2, 24000)
          const samples = buffer.getChannelData(0), view = new DataView(bytes.buffer)
          for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768
          const source = context.createBufferSource()
          source.buffer = buffer; source.connect(context.destination); sources.add(source)
          last = new Promise(resolve => {
            source.onended = () => { sources.delete(source); source.disconnect(); resolve() }
            own.signal.addEventListener('abort', resolve, { once: true })
          })
          next = Math.max(next, context.currentTime + 0.025)
          source.start(next); next += buffer.duration
          if (!started) { started = true; onStart?.() }
        }
        if (!started && !own.signal.aborted) throw new Error('Voice service returned no audio.')
        await last
      } finally { reader.releaseLock() }
    },
  }
}
