'use client'
import { forwardRef } from 'react'
import MiraPet from './MiraPet'
import { miraOrbVoiceState } from '@/lib/miraOrbState'

// The parent VoiceBeam drives this CSS variable using the same audio analyser.
const MiraVoiceCall = forwardRef(function MiraVoiceCall({ state, muted, compact = false }, ref) {
  const label = state === 'loading' ? 'Connecting' : state === 'working' ? 'Using tools' : state === 'speaking' ? 'Mira speaking' : muted ? 'Microphone muted' : 'Listening'
  return <section ref={ref} aria-label="Mira voice call" className={`flex flex-col items-center justify-center text-center ${compact ? 'gap-2 py-2' : 'flex-1 gap-6 px-6 py-12'}`} style={{ '--mira-voice-level': 0 }}>
    <div className={`rounded-full ${compact ? 'p-2' : 'p-5'}`} style={{ boxShadow: '0 0 calc(12px + var(--mira-voice-level) * 64px) rgba(143, 199, 190, .25)', transform: 'scale(calc(1 + var(--mira-voice-level) * .1))' }}><MiraPet size={compact ? 32 : 104} state={state === 'working' ? undefined : miraOrbVoiceState(state)} paused={muted} /></div>
    <div aria-hidden="true" className="flex h-12 items-center justify-center gap-1.5">
      {[12, 20, 28, 36, 44, 36, 28, 20, 12].map((height, i) => <span key={i} className="w-1.5 rounded-full bg-foreground/70" style={{ height, transform: 'scaleY(calc(.35 + var(--mira-voice-level) * 1.8))' }} />)}
    </div>
    {!compact && <p role="status" aria-live="polite" className="text-sm text-default-600">{label}</p>}
  </section>
})
export default MiraVoiceCall
