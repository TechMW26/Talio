'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { miraNavigationPath } from '@/lib/miraNavigation'
import AIActivityBeam from './AIActivityBeam'
import styles from './MiraActivityPointer.module.css'

// Reports real application actions; it never synthesizes clicks or edits the DOM.
export default function MiraActivityPointer() {
  const [mounted, setMounted] = useState(false)
  const [boardActive, setBoardActive] = useState(false)
  const [activity, setActivity] = useState({ label: '', x: 24, y: 88, visible: false, click: 0 })
  useEffect(() => {
    setMounted(true)
    let timer
    const show = (label, phase, target) => {
      clearTimeout(timer)
      const rect = target?.getBoundingClientRect?.()
      const visible = rect && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
      setActivity(previous => ({ label, visible: true, x: Math.max(20, Math.min(innerWidth - 32, visible ? rect.left + rect.width / 2 : innerWidth - 220)), y: Math.max(20, Math.min(innerHeight - 48, visible ? rect.top + rect.height / 2 : 88)), click: phase === 'click' ? previous.click + 1 : 0 }))
      timer = setTimeout(() => setActivity(previous => ({ ...previous, visible: false })), ['done', 'click'].includes(phase) ? 1800 : 90000)
    }
    const action = event => show(event.detail?.label || 'Working', event.detail?.phase, event.detail?.target)
    const agent = event => setBoardActive(Boolean(event.detail?.active))
    const resize = () => setActivity(previous => ({ ...previous, x: Math.max(20, Math.min(innerWidth - 32, previous.x)), y: Math.max(20, Math.min(innerHeight - 48, previous.y)) }))
    const navigate = event => {
      const path = miraNavigationPath(event.detail?.page, event.detail?.id)
      if (!path) return
      const target = [...document.querySelectorAll('a[href]')].find(link => link.getAttribute('href') === path)
      show(`Opening ${event.detail.page}`, 'done', target)
    }
    window.addEventListener('mira:activity', action)
    window.addEventListener('mira:navigate', navigate)
    window.addEventListener('mira:agent-state', agent)
    window.addEventListener('resize', resize)
    return () => { clearTimeout(timer); window.removeEventListener('mira:activity', action); window.removeEventListener('mira:navigate', navigate); window.removeEventListener('mira:agent-state', agent); window.removeEventListener('resize', resize) }
  }, [])
  if (!mounted) return null
  const labelWidth = Math.min(220, window.innerWidth - 48)
  const labelLeft = Math.max(12, Math.min(window.innerWidth - labelWidth - 12, activity.x + 32)) - activity.x
  return createPortal(<>
    {(activity.visible || boardActive) && <div aria-hidden="true" data-testid="mira-page-glow" className={styles.pageGlow}>
      <AIActivityBeam active borderRadius={0} />
    </div>}
    <div role="status" aria-label="MIRA activity" aria-live="polite" aria-hidden={!activity.visible} className={styles.pointer} style={{ opacity: activity.visible ? 1 : 0, transform: `translate3d(${activity.x}px, ${activity.y}px, 0)` }}>
      {activity.click > 0 && <span key={activity.click} className={styles.clickRing} aria-hidden="true" />}
      <img src="/mira-cursor.png" width="48" height="48" alt="" draggable={false} className={`${styles.icon} ${activity.click ? styles.click : ''}`} />
      <span className={styles.label} style={{ left: labelLeft, top: activity.y > window.innerHeight - 100 ? -40 : 24 }}>MIRA · {activity.label}</span>
    </div>
  </>, document.body)
}
