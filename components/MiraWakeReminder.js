'use client'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { getMiraWakeState, getMiraWakeServerState, subscribeMiraWake } from '@/lib/miraWakeState'
const HOUR = 60 * 60 * 1000

export default function MiraWakeReminder() {
  const { status, owner, enable } = useSyncExternalStore(subscribeMiraWake, getMiraWakeState, getMiraWakeServerState)
  const [due, setDue] = useState(false)
  const [dismissed, setDismissed] = useState({ owner: '', until: 0 })
  const key = `mira-wake-remind-after:${owner}`
  useEffect(() => {
    if (!owner || status !== 'off') { setDue(false); return }
    let timer
    const check = () => {
      clearTimeout(timer)
      let until = dismissed.owner === owner ? dismissed.until : 0
      try { until = Math.max(until, Number(localStorage.getItem(key)) || 0) } catch { /* Session-only fallback. */ }
      const remaining = until - Date.now()
      setDue(remaining <= 0)
      if (remaining > 0) timer = setTimeout(check, Math.min(remaining, HOUR))
    }
    check()
    window.addEventListener('focus', check)
    window.addEventListener('storage', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', check)
      window.removeEventListener('storage', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [owner, status, key, dismissed])
  if (!due || status !== 'off' || !enable) return null
  const dismiss = () => {
    const until = Date.now() + HOUR
    try { localStorage.setItem(key, String(until)) } catch { /* Still dismiss in memory. */ }
    setDismissed({ owner, until })
    setDue(false)
  }
  return <aside aria-label="Enable Hey MIRA reminder" className="absolute left-0 top-full mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-default-200 bg-content1 p-4 text-foreground shadow-xl z-50">
    <button onClick={dismiss} aria-label="Dismiss Hey MIRA reminder for one hour" className="absolute right-2 top-2 rounded-lg px-2 py-1 text-default-500 hover:bg-default-100">×</button>
    <p className="pr-6 text-sm font-semibold">Enable Hey MIRA</p>
    <p className="mt-1 text-xs text-default-500">Say “Hey MIRA” to start voice chat.</p>
    <button onClick={enable} className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">Enable</button>
  </aside>
}
