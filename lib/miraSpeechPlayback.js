// Retry only audio acquisition, never the action/chat request or audio already played.
export async function fetchMiraAudio(options) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (options.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    const controller = new AbortController()
    const abort = () => controller.abort()
    options.signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, 12000)
    try {
      const response = await fetch('/api/ai/mira-voice', { ...options, signal: controller.signal })
      if (response.ok) return response
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
      await response.body?.cancel()
      const error = new Error('Voice playback unavailable.')
      error.permanent = !retryable
      throw error
    } catch (error) {
      if (options.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
      if (error.permanent || attempt === 2) throw controller.signal.aborted ? new Error('Voice service timed out.') : error
    } finally {
      clearTimeout(timer)
      options.signal.removeEventListener('abort', abort)
    }
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')) }
      const timer = setTimeout(() => { options.signal.removeEventListener('abort', abort); resolve() }, 350 * (attempt + 1))
      options.signal.addEventListener('abort', abort, { once: true })
      if (options.signal.aborted) abort()
    })
  }
}

// Stream signed 16-bit PCM directly into Web Audio. No full-file download delay.
export function createMiraSpeechPlayback() {
  const context = new (window.AudioContext || window.webkitAudioContext)()
  const ready = context.resume()
  const sources = new Set()
  const pending = new Set()
  let controller, disposed = false
  function cancelActive() {
    controller?.abort()
    for (const source of sources) { source.onended = null; source.stop(); source.disconnect() }
    sources.clear()
  }
  function cancel() {
    cancelActive()
    for (const ticket of pending) ticket.cancel()
    pending.clear()
  }
  function prepare(text) {
    const own = new AbortController()
    let response
    const ticket = {
      own,
      cancel() { own.abort(); response?.body?.cancel().catch(() => {}) },
    }
    pending.add(ticket)
    const token = localStorage.getItem('token') || document.cookie.match(/token=([^;]+)/)?.[1] || ''
    // Settle errors as data: a prefetched request can fail before playback awaits it.
    ticket.result = fetchMiraAudio({ method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ text: text.slice(0, 5000) }), signal: own.signal })
      .then(value => {
        response = value
        if (own.signal.aborted || disposed) { ticket.cancel(); return { cancelled: true } }
        return { response }
      }, error => ({ error }))
    if (disposed) ticket.cancel()
    return ticket
  }
  return {
    cancel,
    prepare,
    close() { disposed = true; cancel(); context.close().catch(() => {}) },
    async speak(text, onStart, prepared) {
      cancelActive()
      const ticket = prepared || prepare(text)
      const own = ticket.own
      controller = own
      await ready
      if (disposed || own.signal.aborted) { ticket.cancel(); pending.delete(ticket); return }
      const result = await ticket.result
      pending.delete(ticket)
      if (result.error) throw result.error
      if (result.cancelled) return
      const { response } = result
      if (disposed || own.signal.aborted) { await response.body?.cancel(); return }
      const reader = response.body.getReader()
      const cancelReader = () => { reader.cancel().catch(() => {}) }
      own.signal.addEventListener('abort', cancelReader, { once: true })
      let tail = new Uint8Array(0), next = context.currentTime, started = false, last
      try {
        while (!own.signal.aborted) {
          let timer
          const { value, done } = await Promise.race([
            reader.read(),
            new Promise((_, reject) => { timer = setTimeout(() => { cancelReader(); reject(new Error('Voice stream timed out.')) }, 12000) }),
          ]).finally(() => clearTimeout(timer))
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
      } finally { own.signal.removeEventListener('abort', cancelReader); reader.releaseLock() }
    },
  }
}
