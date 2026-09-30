'use client'

import { BorderBeam } from 'border-beam'
import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { useTheme } from '@/contexts/ThemeContext'


// Overlay instead of reparenting the form: focus and draft text survive state changes.
export default function AIActivityBeam({ active, strength, theme, borderRadius = 24, fadeMs, scaleWithSize = false, voiceLevelRef }) {
  const reducedMotion = useReducedMotion()
  const { isDarkMode } = useTheme()
  const ref = useRef(null)
  const [scale, setScale] = useState(0)
  const baseScale = Math.min(1, scale)
  // Preserve the existing rail/PiP appearance through about 480 x 270.
  const largeBoost = scaleWithSize ? Math.max(0, Math.min(1, (scale - 1 / 3) / 1.5)) : 0
  const phase = useRef(0)
  useEffect(() => {
    if (!voiceLevelRef || !active || reducedMotion) return
    let frame
    let previousTime
    const update = time => {
      const dt = previousTime === undefined ? 0 : Math.min(64, Math.max(0, time - previousTime))
      previousTime = time
      const level = Math.max(0, Math.min(1, voiceLevelRef.current || 0))
      const beam = ref.current?.querySelector('[data-beam]')
      if (beam) {
        // Advance a continuous colour-flow phase, never restart the border animation.
        phase.current = (phase.current + dt / 1000 * (12 + 108 * level)) % 360
        beam.style.setProperty('--beam-hue-base', `${phase.current}deg`)
        beam.style.setProperty('--beam-strength', String((strength ?? 1) * (scaleWithSize ? 0.85 + baseScale * 0.15 : 1) * (0.45 + 0.55 * level)))
        ref.current.style.filter = `brightness(${0.9 + 0.5 * level})`
      }
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [voiceLevelRef, active, reducedMotion, baseScale, scaleWithSize, strength])
  useEffect(() => {
    if (!scaleWithSize || !ref.current) return
    const measure = ({ width, height }) => {
      // Use both dimensions so a wide, shallow presentation rail stays restrained.
      const next = Math.round(Math.max(0, Math.min(2, (Math.sqrt(width * height) - 140) / 660)) * 100) / 100
      setScale(previous => previous === next ? previous : next)
    }
    measure(ref.current.getBoundingClientRect())
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => measure(entries[0].contentRect))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [scaleWithSize])
  const responsiveGlow = scaleWithSize ? {
    glowSize: 0.9 + baseScale * 1.6 + largeBoost * 0.75,
    brightness: 1.2 + baseScale * 0.8 + largeBoost * 1.2,
    strength: (strength ?? 1) * (0.85 + baseScale * 0.15),
  } : {}
  return <div ref={ref} data-ai-activity-beam aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 rounded-[inherit]">
    <BorderBeam size="pulse-inner" {...(strength === undefined ? {} : { strength })} {...responsiveGlow} active={Boolean(active && !reducedMotion)} theme={theme || (isDarkMode ? 'dark' : 'light')} borderRadius={borderRadius} style={{ width: '100%', height: '100%', borderRadius, pointerEvents: 'none', ...(scaleWithSize ? { '--pulse-glow-boost': 1 + largeBoost * 2, '--beam-stroke-opacity': 1 + largeBoost * .6, '--beam-inner-opacity': 1 + largeBoost * .8, '--beam-bloom-opacity': 1 + largeBoost * .8 } : {}), ...(fadeMs === undefined ? {} : { animationDuration: `${Math.max(0, fadeMs)}ms`, animationDelay: '0s' }) }}>
      <div style={{ width: '100%', height: '100%', borderRadius }} />
    </BorderBeam>
  </div>
}
