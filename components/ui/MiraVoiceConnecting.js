'use client'

import MiraPet from './MiraPet'

export default function MiraVoiceConnecting({ active, onCancel }) {
  if (!active) return null

  return (
    <div data-mira-voice-preparing className="absolute inset-0 z-50 flex items-center justify-center bg-background/40 p-4 backdrop-blur-xl" onClick={event => event.stopPropagation()}>
    <div className="w-full max-w-sm rounded-2xl border border-default-200 bg-background/95 p-5 shadow-xl">
    <div className="flex items-center gap-3">
      <MiraPet size={20} state="connecting" />
      <div role="status" aria-live="polite" aria-atomic="true" className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">Mira is getting ready…</p>
        <p className="mt-0.5 text-xs text-default-500">Connecting voice. Allow microphone access if prompted.</p>
      </div>
      <button type="button" onClick={onCancel} aria-label="Cancel voice connection" className="shrink-0 rounded-lg px-2 py-1 text-xs text-default-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        Cancel
      </button>
    </div>
    <div role="progressbar" aria-label="Preparing Mira voice" aria-valuetext="Connecting to the live call" className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-default-200">
      <span className="absolute inset-y-0 w-1/3 rounded-full bg-primary animate-[miraVoiceLoading_1.2s_ease-in-out_infinite] motion-reduce:animate-none" />
    </div>
    <style>{'@keyframes miraVoiceLoading { from { left: -35%; } to { left: 105%; } }'}</style>
    </div>
    </div>
  )
}
