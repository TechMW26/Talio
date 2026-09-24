'use client'

import dynamic from 'next/dynamic'
import { useReducedMotion } from 'framer-motion'
import { useTheme } from '@/contexts/ThemeContext'

const BorderBeam = dynamic(() => import('border-beam').then(module => module.BorderBeam), { ssr: false })

// Overlay instead of reparenting the form: focus and draft text survive state changes.
export default function AIActivityBeam({ active, strength, theme, borderRadius = 24 }) {
  const reducedMotion = useReducedMotion()
  const { isDarkMode } = useTheme()
  return <div data-ai-activity-beam aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 rounded-[inherit]">
    <BorderBeam size="pulse-inner" {...(strength === undefined ? {} : { strength })} active={Boolean(active && !reducedMotion)} theme={theme || (isDarkMode ? 'dark' : 'light')} borderRadius={borderRadius} style={{ width: '100%', height: '100%', borderRadius, pointerEvents: 'none' }}>
      <div style={{ width: '100%', height: '100%', borderRadius }} />
    </BorderBeam>
  </div>
}
