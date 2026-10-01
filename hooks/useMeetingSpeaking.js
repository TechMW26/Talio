'use client'

import { useEffect, useState } from 'react'
import { createAudioAnalyser } from 'livekit-client'

// Sensitive enough for quiet speech; a lower release threshold prevents flicker.
export const SPEECH_ATTACK_RMS = 0.008
export const SPEECH_RELEASE_RMS = 0.004

export default function useMeetingSpeaking(track, muted, fallback, voiceLevelRef) {
  const [detected, setDetected] = useState(false)
  useEffect(() => {
    setDetected(false)
    if (voiceLevelRef) voiceLevelRef.current = 0
    if (!track?.mediaStreamTrack || muted) return
    let meter
    try { meter = createAudioAnalyser(track, { fftSize: 512, smoothingTimeConstant: 0 }) }
    catch { return } // LiveKit speaker events remain the fallback.
    const samples = new Float32Array(meter.analyser.fftSize)
    let speaking = false
    let frame
    let envelope = 0
    let previousTime
    const sample = (time = performance.now()) => {
      meter.analyser.getFloatTimeDomainData(samples)
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
      const next = rms >= (speaking ? SPEECH_RELEASE_RMS : SPEECH_ATTACK_RMS)
      // Log compression preserves expression in quiet speech without letting peaks dominate.
      const target = Math.max(0, Math.min(1, Math.log1p(Math.max(0, rms - SPEECH_RELEASE_RMS) * 40) / Math.log1p(8)))
      const dt = previousTime === undefined ? 16 : Math.min(100, Math.max(0, time - previousTime))
      previousTime = time
      envelope += (target - envelope) * (1 - Math.exp(-dt / (target > envelope ? 35 : 140)))
      if (voiceLevelRef) voiceLevelRef.current = envelope
      if (next !== speaking) { speaking = next; setDetected(next) }
      frame = requestAnimationFrame(sample)
    }
    sample()
    return () => { cancelAnimationFrame(frame); if (voiceLevelRef) voiceLevelRef.current = 0; void meter.cleanup().catch(() => {}) }
  }, [track, muted, voiceLevelRef])
  return !muted && (detected || fallback)
}
