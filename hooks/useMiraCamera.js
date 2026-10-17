'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { inspectMiraCamera } from '@/lib/miraCamera'

export default function useMiraCamera(open) {
  const [state, setState] = useState('off'), [stream, setStream] = useState(null), [error, setError] = useState('')
  const active = useRef(null), pending = useRef(null), generation = useRef(0), inspection = useRef(null), timer = useRef(null)
  const stop = useCallback(() => {
    generation.current++
    inspection.current?.abort(); inspection.current = null
    clearTimeout(timer.current)
    pending.current?.resolve(null); pending.current = null
    active.current?.getTracks().forEach(track => track.stop()); active.current = null
    setStream(null); setState('off'); setError('')
  }, [])
  const allow = useCallback(async () => {
    const request = pending.current
    if (!request) return
    const version = generation.current
    setState('starting'); setError('')
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15, max: 24 } } })
      if (version !== generation.current || pending.current !== request) { media.getTracks().forEach(track => track.stop()); return }
      active.current = media; setStream(media); setState('active')
      media.getVideoTracks().forEach(track => { track.onended = stop })
      pending.current = null; request.resolve(media)
      timer.current = setTimeout(stop, 120000)
    } catch (err) {
      if (version !== generation.current) return
      pending.current = null; request.resolve(null)
      setError(err.name === 'NotAllowedError' ? 'Camera permission was declined. You can close this preview and continue without it.' : 'The camera is unavailable or in use by another app.')
      setState('error')
    }
  }, [stop])
  const inspect = useCallback(async ({ signal, question } = {}) => {
    if (!open) return { success: false, message: 'Mira is closed.' }
    inspection.current?.abort()
    const controller = new AbortController()
    inspection.current = controller
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const cancelled = () => { pending.current?.resolve(null); pending.current = null; if (!active.current) stop() }
    combined.addEventListener('abort', cancelled, { once: true })
    try {
      combined.throwIfAborted()
      let media = active.current
      if (!media) {
        setState('consent'); setError('')
        media = await new Promise(resolve => { pending.current = { resolve } })
      }
      combined.throwIfAborted()
      if (!media) return { success: false, message: 'Camera access was not granted. Do not claim to see anything.' }
      clearTimeout(timer.current); timer.current = setTimeout(stop, 120000)
      return await inspectMiraCamera(media, { signal: combined, token: localStorage.getItem('token') || '', question })
    } catch (err) {
      if (signal?.aborted) throw err
      if (combined.aborted) return { success: false, message: 'The camera was closed or declined. Do not claim to see anything.' }
      setError(err.message)
      return { success: false, message: err.message }
    } finally { combined.removeEventListener('abort', cancelled); if (inspection.current === controller) inspection.current = null }
  }, [open, stop])
  useEffect(() => { if (!open) stop() }, [open, stop])
  useEffect(() => { window.addEventListener('pagehide', stop); return () => { window.removeEventListener('pagehide', stop); stop() } }, [stop])
  return { state, stream, error, allow, stop, inspect }
}
