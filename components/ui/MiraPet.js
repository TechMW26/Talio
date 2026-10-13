'use client'

import { ThinkingOrb, MODE_FRAMES, resolvePreset } from 'thinking-orbs'
import useMiraOrbState from '@/hooks/useMiraOrbState'
import { MIRA_ORB_STATES } from '@/lib/miraOrbState'

// Keep the ready state calm, but fill the sphere instead of a faint thin ring.
// Reuse the library's tuned globe geometry without its active search sweep.
export function miraIdleOrbFrame(size, time) {
  return MODE_FRAMES.globe(size, time * 0.2, { ...resolvePreset('searching', size).opts, scanMul: 0 })
}

export default function MiraPet({ size = 40, isThinking = false, state, speed = 1, dark, paused = false }) {
  const activity = useMiraOrbState()
  const orbState = MIRA_ORB_STATES.includes(state) ? state : activity !== 'breathing' ? activity : isThinking ? 'solving' : 'breathing'
  const preset = size <= 28 ? 20 : 64
  const idle = orbState === 'breathing'
  return (
    <span data-mira-orb-state={orbState} className="inline-flex shrink-0 items-center justify-center align-middle" style={{ width: size, height: size, borderRadius: '50%', ...(idle ? { background: 'radial-gradient(circle at 30% 24%, #c3d0d8 0%, #697e8c 42%, #24353f 78%, #15232b 100%)', boxShadow: 'inset -3px -3px 8px #0004, inset 1px 1px 3px #ffffff50' } : {}) }}>
      <ThinkingOrb
        size={preset}
        state={orbState}
        speed={speed}
        paused={paused}
        frame={idle ? miraIdleOrbFrame : undefined}
        theme={dark === undefined ? 'auto' : dark ? 'dark' : 'light'}
        style={{ flexShrink: 0, transform: `scale(${size / preset})` }}
        aria-label={`Mira ${orbState}`}
      />
    </span>
  )
}
