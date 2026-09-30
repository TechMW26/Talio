'use client'

import { BorderBeam } from 'border-beam'
import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { useTheme } from '@/contexts/ThemeContext'


// Overlay instead of reparenting the form: focus and draft text survive state changes.
export default function AIActivityBeam({ active, strength, theme, borderRadius = 24, fadeMs, scaleWithSize = false }) {
  const reducedMotion = useReducedMotion()
  const { isDarkMode } = useTheme()
  const ref = useRef(null)
  const [scale, setScale] = useState(0)
  useEffect(() => {
    if (!scaleWithSize || !ref.current) return
    const measure = ({ width, height }) => {
      // Use both dimensions so a wide, shallow presentation rail stays restrained.
      const next = Math.round(Math.max(0, Math.min(1, (Math.sqrt(width * height) - 140) / 660)) * 100) / 100
      setScale(previous => previous === next ? previous : next)
    }
    measure(ref.current.getBoundingClientRect())
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => measure(entries[0].contentRect))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [scaleWithSize])
  const responsiveGlow = scaleWithSize ? {
    glowSize: 0.9 + scale * 1.6,
    brightness: 1.2 + scale * 0.8,
    strength: (strength ?? 1) * (0.85 + scale * 0.15),
  } : {}
  return <div ref={ref} data-ai-activity-beam aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 rounded-[inherit]">
    <BorderBeam size="pulse-inner" {...(strength === undefined ? {} : { strength })} {...responsiveGlow} active={Boolean(active && !reducedMotion)} theme={theme || (isDarkMode ? 'dark' : 'light')} borderRadius={borderRadius} style={{ width: '100%', height: '100%', borderRadius, pointerEvents: 'none', ...(fadeMs === undefined ? {} : { animationDuration: `${Math.max(0, fadeMs)}ms`, animationDelay: '0s' }) }}>
      <div style={{ width: '100%', height: '100%', borderRadius }} />
    </BorderBeam>
  </div>
}
