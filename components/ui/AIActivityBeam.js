'use client'

import { BorderBeam } from 'border-beam'
import { useReducedMotion } from 'framer-motion'
import { useTheme } from '@/contexts/ThemeContext'


// Overlay instead of reparenting the form: focus and draft text survive state changes.
export default function AIActivityBeam({ active, strength, theme, borderRadius = 24, instant = false }) {
  const reducedMotion = useReducedMotion()
  const { isDarkMode } = useTheme()
  return <div data-ai-activity-beam aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 rounded-[inherit]">
    <BorderBeam size="pulse-inner" {...(strength === undefined ? {} : { strength })} active={Boolean(active && !reducedMotion)} theme={theme || (isDarkMode ? 'dark' : 'light')} borderRadius={borderRadius} style={{ width: '100%', height: '100%', borderRadius, pointerEvents: 'none', ...(instant ? { animationDuration: '0s', animationDelay: '0s' } : {}) }}>
      <div style={{ width: '100%', height: '100%', borderRadius }} />
    </BorderBeam>
  </div>
}
