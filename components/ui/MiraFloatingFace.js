'use client'
import { useEffect, useRef } from 'react'
import MiraPet from './MiraPet'
import { miraOrbVoiceState } from '@/lib/miraOrbState'
import { clampMiraFloating, miraFloatingSize } from '@/lib/miraFloatingLayout'

// The padded canvas can hop without clipping; the padding paints nothing.
export default function MiraFloatingFace({ state, isThinking, onRestore, onClose, details, onCloseDetails }) {
  const drag = useRef(null), moved = useRef(false), face = useRef(null)
  const previousSize = useRef({ width: 224, height: 224 })
  const hasDetails = Boolean(details)
  useEffect(() => {
    const clamp = () => {
      const panel = face.current?.closest('.mira-workspace')
      if (!panel) return
      const native = panel.ownerDocument !== document
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const size = miraFloatingSize(hasDetails, native ? {} : viewport)
      const rect = panel.getBoundingClientRect()
      if (!native) {
        const point = clampMiraFloating({ x: rect.left + (previousSize.current.width - size.width) / 2, y: rect.top + previousSize.current.height - size.height }, size, viewport, hasDetails)
        Object.assign(panel.style, { left: `${point.x}px`, top: `${point.y}px`, right: 'auto', bottom: 'auto' })
      }
      panel.style.setProperty('--mira-float-width', `${size.width}px`)
      panel.style.setProperty('--mira-float-height', `${size.height}px`)
      panel.dataset.miraDetails = hasDetails ? 'true' : 'false'
      previousSize.current = size
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => { drag.current = null; window.removeEventListener('resize', clamp) }
  }, [hasDetails])
  return <div className="flex h-full w-full flex-col items-center" style={{ pointerEvents: 'none' }}>
    {details && <section data-mira-floating-details aria-label="Mira details" className="mira-floating-details dark" style={{ pointerEvents: 'auto' }}>
      <header className="flex items-center justify-between gap-3 px-4 py-2">
        <span className="text-xs font-semibold tracking-wide text-neutral-300">Mira details</span>
        <button type="button" aria-label="Close Mira details" onClick={onCloseDetails} className="rounded-full px-2 py-1 text-lg text-neutral-300 hover:bg-white/10 focus-visible:outline" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onCloseDetails() } }}>×</button>
      </header>
      <div className="mira-floating-details-body">{details}</div>
    </section>}
    <div ref={face} data-mira-floating-face role="button" tabIndex={0}
    aria-label="Restore MIRA chat" title="Click to open Mira · drag to move · Escape to close"
    className="flex shrink-0 items-center justify-center outline-none focus-visible:rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    style={{ width: 224, height: 224, touchAction: 'none', cursor: 'grab', background: 'transparent', pointerEvents: 'auto' }}
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
        const { x, y } = clampMiraFloating({ x: active.left + dx, y: active.top + dy }, { width: active.panel.offsetWidth, height: active.panel.offsetHeight }, { width: active.view.innerWidth, height: active.view.innerHeight }, Boolean(details))
        Object.assign(active.panel.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' })
      }
    }}
    onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId) }}
    onPointerCancel={() => { drag.current = null; moved.current = true }}
    onClickCapture={event => { if (moved.current) { event.preventDefault(); event.stopPropagation(); moved.current = false } }}
    onClick={onRestore}>
    <MiraPet size={160} state={state && state !== 'working' ? miraOrbVoiceState(state) : undefined} isThinking={isThinking} />
  </div></div>
}
