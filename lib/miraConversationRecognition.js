// Active conversation audio goes to ElevenLabs. Wake-word audio remains local.
import { strengthenMiraEchoCancellation } from '@/lib/miraEchoGuard'
import { takeMiraVoiceToken } from '@/lib/miraVoiceReady'
export async function startMiraConversationRecognition({ signal, onResult, onPartial, onError }) {
  let stream, socket, source, processor, stopped = false, rejectStartup, timeout
  const context = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 })
  const ready = context.resume()
  const stop = () => {
    if (stopped) return
    stopped = true
    clearTimeout(timeout)
    rejectStartup?.(new DOMException('Voice cancelled', 'AbortError'))
    if (socket) { socket.onclose = null; socket.onerror = null; socket.onmessage = null; socket.close() }
    if (processor) { processor.port.onmessage = null; processor.port.close(); processor.disconnect() }
    source?.disconnect()
    stream?.getTracks().forEach(track => track.stop())
    if (context.state !== 'closed') context.close().catch(() => {})
  }
  const check = () => { if (signal?.aborted || stopped) throw new DOMException('Voice cancelled', 'AbortError') }
  signal?.addEventListener('abort', stop, { once: true })
  try {
    check(); await ready; check()
    const tokenReady = takeMiraVoiceToken()
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false })
    if (stopped) stream.getTracks().forEach(track => track.stop())
    check()
    await strengthenMiraEchoCancellation(stream)
    check()
    const token = await tokenReady
    if (!token) throw new Error('Multilingual recognition is unavailable. Please try again.')
    check()
    // No language_code: Scribe detects the spoken language automatically.
    const params = new URLSearchParams({ token, model_id: 'scribe_v2_realtime', audio_format: `pcm_${context.sampleRate}`, commit_strategy: 'vad', vad_silence_threshold_secs: '0.7', filter_background_audio: 'true' })
    socket = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params}`)
    await new Promise((resolve, reject) => {
      rejectStartup = reject
      timeout = setTimeout(() => reject(new Error('Voice connection timed out. Please try again.')), 15000)
      const fail = () => {
        const error = new Error('Voice connection interrupted. Please restart voice.')
        if (rejectStartup) rejectStartup(error)
        else { stop(); onError(error) }
      }
      socket.onerror = fail
      socket.onclose = () => { if (!stopped) fail() }
      socket.onmessage = event => {
        if (stopped) return
        let data
        try { data = JSON.parse(event.data) } catch { return }
        if (data.message_type === 'session_started') { clearTimeout(timeout); rejectStartup = null; resolve() }
        else if (data.message_type === 'partial_transcript') onPartial?.(data.text || '')
        else if (data.message_type === 'committed_transcript' && data.text?.trim()) onResult({ text: data.text })
        else if (data.error || /error|exceeded|rate_limited/.test(data.message_type || '')) fail()
      }
    })
    check()
    await context.audioWorklet.addModule('/audio/mira-capture-worklet.js')
    check()
    processor = new AudioWorkletNode(context, 'mira-capture')
    processor.port.onmessage = event => {
      if (stopped || socket.readyState !== WebSocket.OPEN) return
      if (socket.bufferedAmount > 256000) { stop(); onError(new Error('Voice connection is too slow. Please reconnect.')); return }
      const samples = event.data, buffer = new ArrayBuffer(samples.length * 2), view = new DataView(buffer)
      for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true)
      const encoded = btoa(String.fromCharCode(...new Uint8Array(buffer)))
      socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: encoded, sample_rate: context.sampleRate }))
    }
    source = context.createMediaStreamSource(stream)
    source.connect(processor); processor.connect(context.destination)
    stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (!stopped) { stop(); onError(new Error('Microphone disconnected.')) } }))
    return { stream, stop }
  } catch (error) { stop(); throw error }
}
