'use client'

import { useEffect, useState } from 'react'
import { miraNavigationPath } from '@/lib/miraNavigation'

// Reports real application actions; it never synthesizes clicks or edits the DOM.
export default function MiraActivityPointer() {
  const [activity, setActivity] = useState({ label: '', x: 24, y: 88, visible: false })
  useEffect(() => {
    let timer
    const show = (label, phase, target) => {
      clearTimeout(timer)
      const rect = target?.getBoundingClientRect()
      const visible = rect && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
      setActivity({ label, visible: true, x: Math.max(12, Math.min(innerWidth - 200, visible ? rect.left + rect.width / 2 : innerWidth - 220)), y: Math.max(12, Math.min(innerHeight - 70, visible ? rect.top + rect.height / 2 : 88)) })
      timer = setTimeout(() => setActivity(previous => ({ ...previous, visible: false })), phase === 'done' ? 2200 : 30000)
    }
    const action = event => show(event.detail?.label || 'Working', event.detail?.phase)
    const navigate = event => {
      const path = miraNavigationPath(event.detail?.page, event.detail?.id)
      if (!path) return
      const target = [...document.querySelectorAll('a[href]')].find(link => link.getAttribute('href') === path)
      show(`Opening ${event.detail.page}`, 'done', target)
    }
    window.addEventListener('mira:activity', action)
    window.addEventListener('mira:navigate', navigate)
    return () => { clearTimeout(timer); window.removeEventListener('mira:activity', action); window.removeEventListener('mira:navigate', navigate) }
  }, [])
  return <div role="status" aria-label="MIRA activity" aria-live="polite" aria-hidden={!activity.visible} className="pointer-events-none fixed left-0 top-0 z-[100001] flex items-start gap-2 transition-[transform,opacity] duration-300 motion-reduce:transition-none" style={{ opacity: activity.visible ? 1 : 0, transform: `translate3d(${activity.x}px, ${activity.y}px, 0)` }}>
    <svg aria-hidden="true" width="22" height="28" viewBox="0 0 22 28"><path d="M2 2v21l6-6 5 9 4-2-5-9h8Z" fill="white" stroke="#243449" strokeWidth="2" /></svg>
    <span className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 shadow-lg">MIRA · {activity.label}</span>
  </div>
}
