'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isMiraWakeResult, startMiraLocalRecognition, storeMiraVoiceProfile } from '@/lib/miraWakeWord'
import { getCurrentUser } from '@/utils/userHelper'
import { publishMiraWakeState } from '@/lib/miraWakeState'

// No enrollment or voice recordings are required.
export default function MiraWakeSetup({ onWake, onStream, suspended = false }) {
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState('off')
  const [error, setError] = useState('')
  const wanted = useRef(false)
  const engine = useRef(null)
  const controller = useRef(null)
  const lastWake = useRef(0)
  const confirmation = useRef(null)
  const wake = useRef(onWake)
  const setupVisible = useRef(visible)
  const startRef = useRef(null)
  setupVisible.current = visible
  wake.current = onWake
  useEffect(() => {
    const openSettings = () => setVisible(true)
    window.addEventListener('mira:voice-settings', openSettings)
    return () => window.removeEventListener('mira:voice-settings', openSettings)
  }, [])
  useEffect(() => {
    const audio = new Audio('/sounds/mira-wake-confirmation.mp3')
    audio.preload = 'auto'
    confirmation.current = audio
    return () => { audio.pause(); confirmation.current = null }
  }, [])
  const owner = () => {
    const user = getCurrentUser()
    if (!user?._id && !user?.id && !user?.userId) throw new Error('Sign in before setting up local voice.')
    return `${user.tenantId || user.companyId || 'account'}:${user._id || user.id || user.userId}`
  }
  useEffect(() => {
    let account = ''
    try { account = owner() } catch { /* Signed-out state has no reminder. */ }
    publishMiraWakeState({ status: suspended ? 'suspended' : status, owner: account, enable: () => startRef.current?.() })
  }, [status, suspended])
  useEffect(() => () => publishMiraWakeState({ status: 'unknown', owner: '', enable: null }), [])
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        if (cancelled) return
        if (localStorage.getItem(`mira-wake-enabled:${owner()}`) !== 'false') {
          wanted.current = true
          if (!suspended) start()
          return
        }
      } catch { /* Optional enrollment must never block the dashboard. */ }
    }
    check()
    return () => { cancelled = true }
  }, [])
  const stop = (disable = true) => {
    if (disable) {
      wanted.current = false
      try { localStorage.setItem(`mira-wake-enabled:${owner()}`, 'false') } catch { /* Storage may be unavailable. */ }
    }
    controller.current?.abort()
    controller.current = null
    engine.current?.stop()
    engine.current = null
    onStream(null)
    setStatus('off')
  }
  useEffect(() => () => { controller.current?.abort(); engine.current?.stop() }, [])
  useEffect(() => {
    if (suspended) { stop(false); setVisible(false) }
    else if (wanted.current) start()
  }, [suspended])
  const start = async () => {
    if (suspended || (controller.current && !controller.current.signal.aborted)) return
    setError('')
    try {
      owner()
      wanted.current = true
      try { localStorage.setItem(`mira-wake-enabled:${owner()}`, 'true') } catch { /* Keep this session enabled. */ }
      setStatus('loading')
      const abort = new AbortController()
      controller.current = abort
      const activate = () => {
        if (abort.signal.aborted || setupVisible.current || Date.now() - lastWake.current <= 6000) return
        lastWake.current = Date.now()
        try {
          const audio = confirmation.current
          if (audio) { audio.currentTime = 0; audio.play()?.catch(() => {}) }
        } catch { /* Confirmation must not block activation. */ }
        try {
          window.electronAPI?.activateMira?.()?.catch(() => {})
        } catch { /* Older desktop versions still open the in-app card. */ }
        wake.current()
      }
      const local = await startMiraLocalRecognition({
        wakeOnly: true,
        signal: abort.signal,
        onError: err => { if (!abort.signal.aborted) { stop(false); setError(err.message); setVisible(true) } },
        onResult: result => {
          if (isMiraWakeResult(result)) activate()
        },
      })
      if (abort.signal.aborted) { local.stop(); return }
      engine.current = local
      onStream(local.stream)
      setStatus('listening')
      setupVisible.current = false
      setVisible(false)
    } catch (err) {
      if (err.name === 'AbortError') return
      stop(false); setError(err.message); setVisible(true)
    }
  }
  startRef.current = start
  return <>
    {status === 'off' && !suspended && <button className="px-4 py-2 text-xs text-default-600 text-left" onClick={() => setVisible(true)}>Enable Hey MIRA</button>}
    {visible && createPortal(<div className="fixed inset-0 z-[100010] flex items-center justify-center bg-black/70 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="mira-wake-title" className="w-full max-w-md rounded-2xl bg-content1 text-foreground border border-default-200 p-6 space-y-4">
        <h2 id="mira-wake-title" className="text-lg font-semibold">Hey MIRA</h2>
        <p className="text-sm text-default-600">Say “Hey MIRA” to open voice chat. Wake listening starts by default while Talio is running, subject to microphone permission. Stop turns it off on this device until you enable it again.</p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {status === 'loading' && <p role="status">Preparing local voice…</p>}
        <div className="flex gap-3 text-sm">
          {status === 'off' && <button disabled={suspended} onClick={start} className="rounded-xl bg-primary text-primary-foreground px-4 py-2">Enable</button>}
          <button onClick={() => { if (status === 'loading') stop(); setVisible(false) }}>{status === 'listening' ? 'Done' : 'Later'}</button>
        </div>
        <details className="text-xs text-default-500"><summary>Privacy & settings</summary>
          <p className="mt-2">Wake audio stays on this device (40 MB model download). No new voice samples are saved. Other voices may activate MIRA. During voice chat, audio goes to ElevenLabs for automatic multilingual transcription, recognized text goes to MIRA, and reply text goes to ElevenLabs for speech. Location is shared with MIRA only when already permitted on this device. Listening resumes after voice chat and is attempted on reload. Your browser may require another click; closed or suspended apps cannot keep listening.</p>
          <div className="mt-3 flex gap-4"><button onClick={stop}>Stop listening</button><button onClick={async () => { try { await storeMiraVoiceProfile(owner(), null); setError('') } catch (err) { setError(err.message) } }}>Delete old voice checks</button></div>
        </details>
      </section>
    </div>, document.body)}
  </>
}
