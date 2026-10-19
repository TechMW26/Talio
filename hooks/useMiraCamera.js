'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { inspectMiraCamera } from '@/lib/miraCamera'

export default function useMiraCamera(open) {
  const [state, setState] = useState('off'), [stream, setStream] = useState(null), [error, setError] = useState('')
  const [capturing, setCapturing] = useState(false)
  const active = useRef(null), pending = useRef(null), generation = useRef(0), inspection = useRef(null), timer = useRef(null)
  const context = useRef({ state: 'off', capturedAt: null })
  const getContext = useCallback(() => ({ ...context.current }), [])
  const stop = useCallback(() => {
    generation.current++
    inspection.current?.abort(); inspection.current = null
    clearTimeout(timer.current)
    pending.current?.resolve(null); pending.current = null
    active.current?.getTracks().forEach(track => track.stop()); active.current = null
    context.current = { state: 'off', capturedAt: null }
    setStream(null); setState('off'); setError(''); setCapturing(false)
  }, [])
  const allow = useCallback(async () => {
    const request = pending.current
    if (!request) return
    const version = generation.current
    setState('starting'); setError('')
    context.current = { state: 'starting', capturedAt: null }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15, max: 24 } } })
      if (version !== generation.current || pending.current !== request) { media.getTracks().forEach(track => track.stop()); return }
      active.current = media; setStream(media); setState('active')
      context.current = { state: 'active', capturedAt: null }
      media.getVideoTracks().forEach(track => { track.onended = stop })
      pending.current = null; request.resolve(media)
      timer.current = setTimeout(stop, 120000)
    } catch (err) {
      if (version !== generation.current) return
      pending.current = null; request.resolve(null)
      setError(err.name === 'NotAllowedError' ? 'Camera permission was declined. You can close this preview and continue without it.' : 'The camera is unavailable or in use by another app.')
      setState('error')
      context.current = { state: 'error', capturedAt: null }
    }
  }, [stop])
  const inspect = useCallback(async ({ signal, question } = {}) => {
    if (!open) return { success: false, message: 'Mira is closed.' }
    if (inspection.current) return { success: false, busy: true, message: 'A camera inspection is already in progress. No additional snapshot was taken.' }
    setError('')
    const controller = new AbortController()
    inspection.current = controller
    setCapturing(true)
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const cancelled = () => { pending.current?.resolve(null); pending.current = null; if (!active.current) stop() }
    combined.addEventListener('abort', cancelled, { once: true })
    try {
      combined.throwIfAborted()
      let media = active.current
      if (!media) {
        // Reuse OS/setup permission. getUserMedia remains the OS/browser gate.
        media = await new Promise(resolve => { pending.current = { resolve }; void allow() })
      }
      combined.throwIfAborted()
      if (!media) return { success: false, message: 'Camera access was not granted. Do not claim to see anything.' }
      clearTimeout(timer.current); timer.current = setTimeout(stop, 120000)
      const result = await inspectMiraCamera(media, { signal: combined, token: localStorage.getItem('token') || '', question,
        onCaptured: () => { if (inspection.current === controller) setCapturing(false) },
      })
      combined.throwIfAborted()
      if (active.current !== media) return { success: false, message: 'Camera is off. No current view is available.' }
      context.current.capturedAt = result.capturedAt
      return { ...result, cameraContext: getContext() }
    } catch (err) {
      if (signal?.aborted) throw err
      if (combined.aborted) return { success: false, message: 'The camera was closed or declined. Do not claim to see anything.' }
      setError(err.message)
      return { success: false, message: err.message }
    } finally { combined.removeEventListener('abort', cancelled); if (inspection.current === controller) { inspection.current = null; setCapturing(false) } }
  }, [open, stop, allow, getContext])
  useEffect(() => { if (!open) stop() }, [open, stop])
  useEffect(() => { window.addEventListener('pagehide', stop); return () => { window.removeEventListener('pagehide', stop); stop() } }, [stop])
  return { state, stream, error, capturing, stop, inspect, getContext }
}
