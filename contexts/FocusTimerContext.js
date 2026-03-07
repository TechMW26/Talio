'use client'

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { playTaskDoneSound } from '@/utils/audio'

const FocusTimerContext = createContext(null)

const TIMER_PRESETS = [5, 10, 15, 25, 30, 45, 60]

export function FocusTimerProvider({ children }) {
  const [duration, setDuration] = useState(25)
  const [total, setTotal] = useState(25 * 60)
  const [left, setLeft] = useState(25 * 60)
  const [running, setRunning] = useState(false)
  const intervalRef = useRef(null)

  useEffect(() => {
    if (!running) return
    intervalRef.current = setInterval(() => {
      setLeft(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current)
          setRunning(false)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(intervalRef.current)
  }, [running])

  // Play sound and send push notification when timer completes
  const hasNotifiedRef = useRef(false)
  useEffect(() => {
    if (left === 0 && !running && total > 0 && !hasNotifiedRef.current) {
      hasNotifiedRef.current = true
      playTaskDoneSound().catch(() => {})

      // Send push notification to all user devices
      const token = localStorage.getItem('token')
      if (token) {
        fetch('/api/focus-timer/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ duration }),
        }).catch(() => {})
      }
    }
    if (left > 0) hasNotifiedRef.current = false
  }, [left, running, total, duration])

  const pickDuration = useCallback((mins) => {
    setDuration(mins)
    setTotal(mins * 60)
    setLeft(mins * 60)
    setRunning(false)
    clearInterval(intervalRef.current)
  }, [])

  const toggle = useCallback(() => {
    if (left === 0) {
      // Reset when done
      setTotal(duration * 60)
      setLeft(duration * 60)
    } else {
      setRunning(r => !r)
    }
  }, [left, duration])

  const reset = useCallback(() => {
    setRunning(false)
    clearInterval(intervalRef.current)
    setTotal(duration * 60)
    setLeft(duration * 60)
  }, [duration])

  const pct = total > 0 ? ((total - left) / total) * 100 : 0
  const done = left === 0
  const mins = String(Math.floor(left / 60)).padStart(2, '0')
  const secs = String(left % 60).padStart(2, '0')

  return (
    <FocusTimerContext.Provider value={{
      duration, total, left, running, done, pct, mins, secs,
      pickDuration, toggle, reset,
      TIMER_PRESETS,
    }}>
      {children}
    </FocusTimerContext.Provider>
  )
}

export function useFocusTimer() {
  const ctx = useContext(FocusTimerContext)
  if (!ctx) throw new Error('useFocusTimer must be used within FocusTimerProvider')
  return ctx
}
