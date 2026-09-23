'use client'

import { useEffect, useRef, useState } from 'react'

export function clampMiraSidebarPosition(position, viewport, size) {
  const margin = 12
  return {
    x: Math.max(margin, Math.min(position.x, viewport.width - size.width - margin)),
    y: Math.max(margin, Math.min(position.y, viewport.height - size.height - margin)),
  }
}

export default function useMiraSidebarDrag(enabled) {
  const [position, setPosition] = useState(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef(null)
  const frame = useRef(null)
  const pending = useRef(null)
  const bounds = point => clampMiraSidebarPosition(point,
    { width: window.innerWidth, height: window.innerHeight },
    { width: Math.min(460, window.innerWidth - 24), height: window.innerHeight - 24 })

  const finish = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    if (pending.current) setPosition(pending.current)
    pending.current = null
    const active = drag.current
    drag.current = null
    if (active?.target.hasPointerCapture?.(active.id)) active.target.releasePointerCapture(active.id)
    setDragging(false)
  }
  useEffect(() => {
    if (!enabled) finish()
    const resize = () => { finish(); setPosition(previous => previous ? bounds(previous) : null) }
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
      const active = drag.current
      drag.current = null
      if (active?.target.hasPointerCapture?.(active.id)) active.target.releasePointerCapture(active.id)
    }
  }, [enabled])

  return {
    position, dragging,
    handlers: {
      onPointerDown(event) {
        if (!enabled || event.button !== 0 || event.isPrimary === false || event.target.closest('button, input, textarea, a')) return
        const panel = event.currentTarget.closest('[role="dialog"]')
        if (!panel) return
        const rect = panel.getBoundingClientRect()
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, target: event.currentTarget }
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
        event.preventDefault()
      },
      onPointerMove(event) {
        const active = drag.current
        if (!enabled || !active || active.id !== event.pointerId) return
        pending.current = bounds({ x: active.left + event.clientX - active.x, y: active.top + event.clientY - active.y })
        if (frame.current === null) frame.current = requestAnimationFrame(() => {
          frame.current = null
          if (pending.current) setPosition(pending.current)
          pending.current = null
        })
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onKeyDown(event) {
        if (!enabled || event.target !== event.currentTarget) return
        const delta = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key]
        if (!delta) return
        event.preventDefault()
        setPosition(previous => bounds({ x: (previous?.x ?? 12) + delta[0], y: (previous?.y ?? 12) + delta[1] }))
      },
    },
  }
}
