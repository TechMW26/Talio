'use client'
import { useEffect, useRef, useState } from 'react'
import { MIRA_ROBOT_SLEEP_MS } from '@/lib/miraRobotState'

// Cosmetic sleep must never end a call or start/stop a microphone.
export default function useMiraRobotState(phase, canvas) {
  const [sleeping, setSleeping] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const phaseRef = useRef(phase), wakeRef = useRef(null)
  phaseRef.current = phase
  useEffect(() => {
    let sleepTimer, feedbackTimer, lastWake = -Infinity
    const wake = () => {
      const now = Date.now()
      if (now - lastWake < 500) return
      lastWake = now
      setSleeping(false)
      clearTimeout(sleepTimer)
      if (['idle', 'listening'].includes(phaseRef.current)) sleepTimer = setTimeout(() => { setFeedback(null); setSleeping(true) }, MIRA_ROBOT_SLEEP_MS)
    }
    const react = event => {
      wake()
      const state = event.detail?.state
      clearTimeout(feedbackTimer)
      setFeedback(['happy', 'error'].includes(state) ? state : null)
      if (state !== 'awake') feedbackTimer = setTimeout(() => setFeedback(null), state === 'error' ? 4000 : 1800)
    }
    wakeRef.current = () => { lastWake = -Infinity; wake() }
    setSleeping(false); wake()
    window.addEventListener('mira:robot-feedback', react)
    // A native PiP adopts this canvas into a child document without remounting.
    const documents = new Set()
    const bind = () => {
      for (const doc of [document, canvas.current?.ownerDocument]) {
        if (!doc || documents.has(doc)) continue
        documents.add(doc)
        doc.addEventListener('pointermove', wake, { passive: true })
        doc.addEventListener('pointerdown', wake, { passive: true })
        doc.addEventListener('keydown', wake)
      }
    }
    bind()
    const adoption = setInterval(bind, 1000)
    return () => {
      clearInterval(adoption); clearTimeout(sleepTimer); clearTimeout(feedbackTimer)
      window.removeEventListener('mira:robot-feedback', react)
      documents.forEach(doc => {
        doc.removeEventListener('pointermove', wake)
        doc.removeEventListener('pointerdown', wake)
        doc.removeEventListener('keydown', wake)
      })
    }
  }, [canvas])
  useEffect(() => { wakeRef.current?.() }, [phase])
  return feedback && ['idle', 'listening'].includes(phase) ? feedback : sleeping ? 'sleeping' : phase
}
