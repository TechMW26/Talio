'use client'
import { useEffect, useState } from 'react'
import { Button, Switch } from '@/components/ui/fernly'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { LEVELS } from '@/lib/designationLevels'
import { miraSettingsRequest, saveMiraAccess } from '@/lib/client/miraSettings'

function AdminPanel({ settings, mutate }) {
  const [enabled, setEnabled] = useState(settings.enabled), [allowedLevels, setAllowedLevels] = useState(settings.allowedLevels)
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const { data: agentStatus, mutate: refreshAgent } = useAuthedSWR('/api/mira/agent')
  useEffect(() => { setEnabled(settings.enabled); setAllowedLevels(settings.allowedLevels) }, [settings])
  const save = async () => {
    setBusy('save'); setError(''); setNotice('')
    try { const result = await saveMiraAccess({ enabled, allowedLevels }); await mutate(previous => ({ ...previous, settings: result.settings }), false); setNotice('Mira access saved.') }
    catch (err) { setError(err.message) }
    finally { setBusy('') }
  }
  const sync = async () => {
    setBusy('sync'); setError(''); setNotice('')
    try { const result = await miraSettingsRequest('/api/mira/agent', {}); await refreshAgent(result, false); setNotice('Mira voice agent synced with the shared system prompt.') }
    catch (err) { setError(err.message) }
    finally { setBusy('') }
  }
  const dirty = enabled !== settings.enabled || [...allowedLevels].sort().join(',') !== [...settings.allowedLevels].sort().join(',')
  return <section className="rounded-2xl border border-default-200 bg-content1 p-5 md:p-6 space-y-5">
    <div><h3 className="text-lg font-semibold text-foreground">Organisation access</h3><p className="mt-1 text-sm text-default-500">Choose which designation levels can open Mira. The same rule applies to voice, chat and actions. Administrator account roles are unchanged.</p></div>
    <Switch isSelected={enabled} onValueChange={setEnabled} isDisabled={!!busy}>Mira {enabled ? 'enabled' : 'disabled'}</Switch>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {LEVELS.map(({ level, levelName }) => <div key={level} className="rounded-xl border border-default-200 p-3">
        <Switch isSelected={allowedLevels.includes(level)} isDisabled={!!busy || !enabled} onValueChange={value => setAllowedLevels(previous => value ? [...previous, level] : previous.filter(item => item !== level))}>L{level} · {levelName}</Switch>
      </div>)}
    </div>
    <p className="text-xs text-default-500">After saving, users without an assigned designation level cannot use Mira. Turning Mira off preserves preferences and conversations. Administrators can always change these controls here.</p>
    <Button color="primary" onPress={save} isDisabled={!!busy || !dirty} isLoading={busy === 'save'}>Save access</Button>
    <div className="border-t border-default-200 pt-5 flex flex-wrap items-center justify-between gap-4">
      <div><h4 className="font-medium">Mira voice agent</h4><p className="mt-1 text-sm text-default-500">Private live voice · secure Talio tools and permissions</p>
        <p role="status" className="mt-1 text-xs text-default-500">{!agentStatus ? 'Checking agent…' : agentStatus.needsSync ? agentStatus.canStart ? 'Voice configuration ready · shared prompt update pending' : 'Agent setup or prompt sync required' : 'Shared prompt is synced'}{agentStatus?.agent?.syncedAt ? ` · Last confirmed: ${new Date(agentStatus.agent.syncedAt).toLocaleString()}` : ''}</p>
      </div>
      <Button onPress={sync} isLoading={busy === 'sync'} isDisabled={!!busy}>{agentStatus?.agent ? 'Sync shared prompt' : 'Create Mira agent'}</Button>
    </div>
    <p className="text-xs text-default-500">Only shared instructions are synced to the agent. Each private call receives your saved name, company and gender when available; other workplace data is fetched only when needed. Personal details are never added to the shared prompt. Voice sessions last up to 10 minutes; reconnect to continue.</p>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
  </section>
}

export default function MiraAdminSettings() {
  const { data, error, isLoading, mutate } = useAuthedSWR('/api/mira/access')
  if (isLoading) return <p role="status" className="text-sm text-default-500">Loading Mira access…</p>
  if (error) return <div role="alert" className="text-sm text-danger">Could not load Mira access. <Button onPress={() => mutate()}>Retry</Button></div>
  if (!data?.canManage || !data.settings) return null
  return <AdminPanel settings={data.settings} mutate={mutate} />
}
