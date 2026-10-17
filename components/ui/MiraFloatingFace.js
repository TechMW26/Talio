'use client'
import { useEffect, useRef } from 'react'
import MiraPet from './MiraPet'
import { miraOrbVoiceState } from '@/lib/miraOrbState'

// The padded canvas can hop without clipping; the padding paints nothing.
export default function MiraFloatingFace({ state, isThinking, onRestore, onClose }) {
  const drag = useRef(null), moved = useRef(false), face = useRef(null)
  useEffect(() => {
    const clamp = () => {
      const panel = face.current?.closest('.mira-workspace')
      if (!panel || panel.ownerDocument !== document || !panel.style.left || panel.style.left === 'auto') return
      const rect = panel.getBoundingClientRect()
      panel.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - panel.offsetWidth))}px`
      panel.style.top = `${Math.max(0, Math.min(rect.top, window.innerHeight - panel.offsetHeight))}px`
    }
    window.addEventListener('resize', clamp)
    return () => { drag.current = null; window.removeEventListener('resize', clamp) }
  }, [])
  return <div ref={face} data-mira-floating-face role="button" tabIndex={0}
    aria-label="Restore MIRA chat" title="Click to open Mira · drag to move · Escape to close"
    className="flex h-full w-full items-center justify-center outline-none focus-visible:rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    style={{ touchAction: 'none', cursor: 'grab', background: 'transparent' }}
    onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onRestore() }
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }}
    onPointerDown={event => {
      if (event.button !== 0) return
      const panel = event.currentTarget.closest('.mira-workspace'), view = event.currentTarget.ownerDocument.defaultView
      if (!panel) return
      const native = view !== window && window.electronAPI?.moveLivePip
      const rect = panel.getBoundingClientRect()
      moved.current = false
      drag.current = { id: event.pointerId, panel, view, native, x: event.screenX, y: event.screenY, left: native ? view.screenX : rect.left, top: native ? view.screenY : rect.top }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }}
    onPointerMove={event => {
      const active = drag.current
      if (!active || event.pointerId !== active.id) return
      const dx = event.screenX - active.x, dy = event.screenY - active.y
      if (!moved.current && Math.hypot(dx, dy) < 5) return
      moved.current = true
      if (active.native) window.electronAPI.moveLivePip({ x: active.left + dx, y: active.top + dy }).catch(() => {})
      else {
        const x = Math.max(0, Math.min(active.view.innerWidth - active.panel.offsetWidth, active.left + dx))
        const y = Math.max(0, Math.min(active.view.innerHeight - active.panel.offsetHeight, active.top + dy))
        Object.assign(active.panel.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' })
      }
    }}
    onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId) }}
    onPointerCancel={() => { drag.current = null; moved.current = true }}
    onClickCapture={event => { if (moved.current) { event.preventDefault(); event.stopPropagation(); moved.current = false } }}
    onClick={onRestore}>
    <MiraPet size={160} state={state && state !== 'working' ? miraOrbVoiceState(state) : undefined} isThinking={isThinking} />
  </div>
}
