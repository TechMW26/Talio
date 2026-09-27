'use client'

import { useEffect, useRef, useState } from 'react'
import { FaCheck, FaMicrophone, FaSave, FaVolumeUp } from 'react-icons/fa'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { toast } from '@/utils/toast'
import { createMiraSpeechPlayback } from '@/lib/miraSpeechPlayback'

export default function MiraSettings() {
  const { data: response, isLoading, mutate } = useAuthedSWR('/api/mira/preferences')
  const [voiceId, setVoiceId] = useState('jJ0Hr51MaPgsgfPtFdR4')
  const [customInstructions, setCustomInstructions] = useState('')
  const [knowledge, setKnowledge] = useState('')
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const playbackRef = useRef(null)
  const voices = response?.voices || []

  useEffect(() => {
    if (!response?.data) return
    setVoiceId(response.data.voiceId)
    setCustomInstructions(response.data.customInstructions || '')
    setKnowledge(response.data.knowledge || '')
  }, [response])

  useEffect(() => () => {
    playbackRef.current?.close()
    playbackRef.current = null
  }, [])

  async function save() {
    setSaving(true)
    try {
      const token = localStorage.getItem('token')
      const result = await fetch('/api/mira/preferences', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ voiceId, customInstructions, knowledge }),
      })
      const body = await result.json()
      if (!result.ok || !body.success) throw new Error(body.message || 'Could not save MIRA settings.')
      await mutate({ ...response, data: body.data }, false)
      toast.success('MIRA settings saved')
    } catch (error) { toast.error(error.message || 'Could not save MIRA settings.') }
    finally { setSaving(false) }
  }

  async function preview() {
    playbackRef.current?.close()
    setPreviewing(true)
    let playback
    try {
      playback = createMiraSpeechPlayback({ voiceId })
      playbackRef.current = playback
      await playback.speak('Hello, I am MIRA. How can I help you today?', () => {})
    } catch (error) {
      if (playbackRef.current === playback && error?.name !== 'AbortError') toast.error(error.message || 'Voice preview is unavailable.')
    } finally {
      playback?.close()
      if (playbackRef.current === playback) { playbackRef.current = null; setPreviewing(false) }
    }
  }

  return <div className="space-y-7">
    <section className="rounded-2xl border border-default-200 bg-content1 p-5 md:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-lg font-semibold text-foreground">MIRA voice</h3><p className="mt-1 text-sm text-default-500">Choose how MIRA sounds in spoken replies. Your choice follows your account across devices.</p></div>
        <button type="button" onClick={preview} disabled={isLoading || previewing} className="inline-flex items-center gap-2 rounded-xl border border-default-200 px-4 py-2 text-sm font-medium text-foreground hover:bg-default-100 disabled:opacity-50">
          <FaVolumeUp aria-hidden="true" /> {previewing ? 'Playing preview…' : 'Preview selected voice'}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {voices.map(voice => <button key={voice.id} type="button" onClick={() => setVoiceId(voice.id)} aria-pressed={voiceId === voice.id} className={`rounded-xl border p-4 text-left transition-colors ${voiceId === voice.id ? 'border-primary-500 bg-primary-500/10 ring-1 ring-primary-500' : 'border-default-200 hover:bg-default-100'}`}>
          <span className="flex items-start justify-between gap-3"><span><span className="block font-semibold text-foreground">{voice.name}</span><span className="mt-1 block text-sm text-default-500">{voice.description}</span><span className="mt-2 block text-xs text-default-400">{voice.accent}</span></span>{voiceId === voice.id && <FaCheck className="mt-1 text-primary-500" aria-label="Selected" />}</span>
        </button>)}
      </div>
      <p className="mt-3 flex items-center gap-2 text-xs text-default-500"><FaMicrophone aria-hidden="true" />Voice previews use ElevenLabs and the current MIRA speech service.</p>
    </section>

    <section className="rounded-2xl border border-default-200 bg-content1 p-5 md:p-6">
      <h3 className="text-lg font-semibold text-foreground">Personal instructions</h3>
      <p className="mt-1 mb-3 text-sm text-default-500">Tell MIRA how you prefer it to work, such as your response style or recurring preferences.</p>
      <textarea value={customInstructions} onChange={event => setCustomInstructions(event.target.value)} maxLength={1600} rows={4} className="w-full rounded-xl border border-default-200 bg-default-50 p-3 text-sm text-foreground outline-none focus:border-primary-500" placeholder="Example: Keep routine answers concise and use my team's project naming conventions." />
      <div className="mt-1 text-right text-xs text-default-400">{customInstructions.length}/1600</div>
    </section>

    <section className="rounded-2xl border border-default-200 bg-content1 p-5 md:p-6">
      <h3 className="text-lg font-semibold text-foreground">My knowledge for MIRA</h3>
      <p className="mt-1 mb-3 text-sm text-default-500">Add personal context MIRA can use when it helps answer you. Do not add passwords or sensitive credentials.</p>
      <textarea value={knowledge} onChange={event => setKnowledge(event.target.value)} maxLength={8000} rows={7} className="w-full rounded-xl border border-default-200 bg-default-50 p-3 text-sm text-foreground outline-none focus:border-primary-500" placeholder="Add useful context such as your role, projects, terminology, or preferences…" />
      <div className="mt-1 text-right text-xs text-default-400">{knowledge.length}/8000</div>
    </section>

    <div className="flex justify-end"><button type="button" onClick={save} disabled={saving || isLoading} className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"><FaSave aria-hidden="true" />{saving ? 'Saving…' : 'Save MIRA settings'}</button></div>
  </div>
}
