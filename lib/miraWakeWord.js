import { prepareMiraAudioCapture, createMiraAudioCapture } from '@/lib/miraAudioCapture'
// Exact two-word wake phrase only; no standalone name or phonetic variants.
export function isMiraWakeResult(result, threshold = 0.9) {
  const words = result?.result || []
  return words.some((hey, index) => {
    const mira = words[index + 1]
    return Boolean(hey?.word?.toLowerCase() === 'hey' && mira?.word?.toLowerCase() === 'mira' &&
    hey.conf >= threshold && mira.conf >= threshold &&
    [hey.start, hey.end, mira.start, mira.end].every(Number.isFinite) &&
    hey.end > hey.start && mira.end > mira.start &&
    mira.start >= hey.end &&
    mira.start >= hey.start && mira.start - hey.end <= 0.65 &&
    mira.end - hey.start >= 0.2 && mira.end - hey.start <= 2.5)
  })
}

// Partial transcripts have no confidence score and must never activate MIRA.
export function isMiraWakePartial(text) {
  return false
}

export async function startMiraLocalRecognition({ onResult, onPartial, onError, signal, wakeOnly = false }) {
  // Called only after explicit user consent. No recognition audio leaves this device.
  let stream, model, source, processor, cancelLoad, stopped = false, paused = false
  const context = new AudioContext()
  const resume = context.resume()
  const stop = () => {
    if (stopped) return
    stopped = true
    cancelLoad?.()
    stream?.getTracks().forEach(track => track.stop())
    processor?.close()
    source?.disconnect()
    if (context && context.state !== 'closed') context.close().catch(() => {})
    model?.terminate()
    model?.worker?.terminate()
  }
  signal?.addEventListener('abort', stop, { once: true })
  const check = () => { if (signal?.aborted || stopped) throw new DOMException('Listening cancelled', 'AbortError') }
  try {
    check()
    await resume
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false })
    if (stopped) stream.getTracks().forEach(track => track.stop())
    check()
    const vosk = await import('vosk-browser')
    check()
    model = new vosk.Model('/models/mira-vosk-en-0.15.tar.gz', -1)
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Local speech model load timed out. Try again.')), 90000)
      cancelLoad = () => { clearTimeout(timeout); reject(new DOMException('Listening cancelled', 'AbortError')) }
      model.on('load', event => { clearTimeout(timeout); event.result ? resolve() : reject(new Error('Unable to load local speech model.')) })
      model.on('error', event => { clearTimeout(timeout); reject(new Error(event.error || 'Local recognition failed.')) })
    })
    check()
    const recognizer = new model.KaldiRecognizer(context.sampleRate, wakeOnly ? JSON.stringify(['hey mira', '[unk]']) : undefined)
    recognizer.setWords(true)
    recognizer.on('result', event => { if (!paused && !stopped) onResult(event.result) })
    recognizer.on('partialresult', event => { if (!paused && !stopped) onPartial?.(event.result?.partial || '') })
    model.on('error', event => { stop(); onError(new Error(event.error || 'Local recognition stopped.')) })
    const useWorklet = await prepareMiraAudioCapture(context)
    check()
    processor = createMiraAudioCapture(context, useWorklet, samples => { if (!paused && !stopped) recognizer.acceptWaveformFloat(samples, context.sampleRate) })
    source = context.createMediaStreamSource(stream)
    source.connect(processor.node)
    // Worklet outputs silence; keeping it connected schedules capture without feedback.
    processor.node.connect(context.destination)
    stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (!stopped) { stop(); onError(new Error('Microphone disconnected. Please reconnect it.')) } }))
    return { stream, stop, setPaused: value => { paused = value }, flush: () => recognizer.retrieveFinalResult() }
  } catch (error) { stop(); throw error }
}

export async function storeMiraVoiceProfile(owner, value) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('talio-mira-local-voice', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('profiles')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction('profiles', value === undefined ? 'readonly' : 'readwrite')
      const store = tx.objectStore('profiles')
      const request = value === undefined ? store.get(owner) : value === null ? store.delete(owner) : store.put(value, owner)
      tx.oncomplete = () => resolve(value === undefined ? request.result : undefined)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('Local storage was interrupted.'))
    })
  } finally { database.close() }
}
