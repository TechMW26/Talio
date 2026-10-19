'use client'
import { useState } from 'react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { toast } from '@/utils/toast'

export default function MiraDesktopHabits() {
  const { data, error, isLoading, mutate } = useAuthedSWR('/api/mira/desktop-habits')
  const [saving, setSaving] = useState(false)
  const preferences = data?.data
  async function update(change) {
    setSaving(true)
    try {
      const response = await fetch('/api/mira/desktop-habits', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, body: JSON.stringify(change) })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error('Could not update learned preferences.')
      await mutate()
      toast.success(change.operation === 'clear' ? 'Learned preferences cleared' : 'Learning preference saved')
    } catch (error) { toast.error(error.message) }
    finally { setSaving(false) }
  }
  return <section className="rounded-2xl border border-default-200 bg-content1 p-5 md:p-6" aria-busy={saving || isLoading}>
    <h3 className="text-lg font-semibold text-foreground">Desktop music preferences</h3>
    <p className="mt-1 text-sm text-default-500">Mira learns your music app and songs from successful requests you make to Mira—not from background monitoring. Explicit choices always win. Entries expire after 90 days without use.</p>
    {isLoading ? <p className="mt-4 text-sm" role="status">Loading preferences…</p> : error || !preferences ? <p className="mt-4 text-sm text-danger" role="alert">Preferences could not load. <button type="button" className="underline" onClick={() => mutate()}>Retry</button></p> : <>
      <label className="mt-4 flex items-start gap-3 text-sm text-foreground"><input type="checkbox" className="mt-1" checked={preferences.enabled} disabled={saving} onChange={event => update({ operation: 'enabled', enabled: event.target.checked })} />Learn from successful music requests</label>
      <ul className="mt-4 space-y-1 text-sm text-default-500">{preferences.music.slice(0, 5).map((row, index) => <li className="break-words" key={`${row.app}-${index}`}>{row.app}{row.song ? ` · ${row.song}` : ''} · {row.count} successful requests</li>)}</ul>
      {!preferences.music.length && <p className="mt-3 text-sm text-default-500">No learned preferences yet. A clear repeated choice becomes your default after two successful requests.</p>}
      <button type="button" disabled={saving || !preferences.music.length} onClick={() => update({ operation: 'clear' })} className="mt-4 rounded-xl border border-default-200 px-4 py-2 text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Forget learned preferences'}</button>
    </>}
  </section>
}
