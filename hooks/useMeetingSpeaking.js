'use client'

import { useEffect, useState } from 'react'
import { createAudioAnalyser } from 'livekit-client'

// Sensitive enough for quiet speech; a lower release threshold prevents flicker.
export const SPEECH_ATTACK_RMS = 0.008
export const SPEECH_RELEASE_RMS = 0.004

export default function useMeetingSpeaking(track, muted, fallback) {
  const [detected, setDetected] = useState(false)
  useEffect(() => {
    setDetected(false)
    if (!track?.mediaStreamTrack || muted) return
    let meter
    try { meter = createAudioAnalyser(track, { fftSize: 512, smoothingTimeConstant: 0 }) }
    catch { return } // LiveKit speaker events remain the fallback.
    const samples = new Float32Array(meter.analyser.fftSize)
    let speaking = false
    let frame
    const sample = () => {
      meter.analyser.getFloatTimeDomainData(samples)
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
      const next = rms >= (speaking ? SPEECH_RELEASE_RMS : SPEECH_ATTACK_RMS)
      if (next !== speaking) { speaking = next; setDetected(next) }
      frame = requestAnimationFrame(sample)
    }
    sample()
    return () => { cancelAnimationFrame(frame); void meter.cleanup().catch(() => {}) }
  }, [track, muted])
  return !muted && (detected || fallback)
}
