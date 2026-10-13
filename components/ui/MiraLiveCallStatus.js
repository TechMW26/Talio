'use client'
import { FaMicrophone, FaMicrophoneSlash, FaPhone } from 'react-icons/fa'

export default function MiraLiveCallStatus({ state, muted, onMute, onEnd }) {
  if (!state || state === 'idle') return null
  const connecting = state === 'loading'
  return <div className="flex items-center justify-center gap-4 py-2">
    {!connecting && onMute && <button type="button" onClick={event => { event.stopPropagation(); onMute() }} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} title={muted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={muted} className="flex h-11 w-11 items-center justify-center rounded-full bg-default-100 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{muted ? <FaMicrophoneSlash aria-hidden="true" /> : <FaMicrophone aria-hidden="true" />}</button>}
    <button type="button" onClick={event => { event.stopPropagation(); onEnd() }} aria-label={connecting ? 'Cancel live call' : 'End live call'} title={connecting ? 'Cancel voice connection' : 'End call'} className="flex h-11 w-11 items-center justify-center rounded-full bg-danger/15 text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><FaPhone aria-hidden="true" className="rotate-[135deg]" /></button>
  </div>
}
