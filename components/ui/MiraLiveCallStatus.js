'use client'

export default function MiraLiveCallStatus({ state, voiceName, onEnd }) {
  if (!state || state === 'idle') return null
  const connecting = state === 'loading'
  const label = connecting ? 'Connecting…' : state === 'speaking' ? 'Mira speaking' : state === 'thinking' ? 'Preparing reply' : 'Listening'
  return <div className="mb-2 flex items-center gap-3 rounded-xl border border-default-200 bg-default-100/50 px-3 py-2">
    <span className={`h-2 w-2 shrink-0 rounded-full ${connecting ? 'bg-warning' : 'bg-success'}`} aria-hidden="true" />
    <div role="status" aria-live="polite" aria-atomic="true" className="min-w-0 flex-1">
      <p className="text-xs font-medium text-foreground">Live call · {label}</p>
      <p className="text-[11px] text-default-500">{connecting ? 'Allow microphone access when prompted.' : `ElevenLabs · ${voiceName || 'Mira'} · speak naturally`}</p>
    </div>
    <button type="button" onClick={onEnd} aria-label={connecting ? 'Cancel live call' : 'End live call'} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{connecting ? 'Cancel' : 'End call'}</button>
  </div>
}
