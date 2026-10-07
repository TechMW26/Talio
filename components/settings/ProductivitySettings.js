'use client'
import { useEffect, useState } from 'react'
import { Button, Switch } from '@/components/ui/fernly'
import { productivitySettingsRequest } from '@/lib/client/productivitySettings'

export default function ProductivitySettings() {
  const [settings, setSettings] = useState(null), [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false)
  const load = async () => {
    setError('')
    try { const data = await productivitySettingsRequest(); setSettings(data); setEnabled(data.screenshotsEnabled) }
    catch (error) { setError(error.message) }
  }
  useEffect(() => { load() }, [])
  const save = async () => {
    setBusy(true); setError(''); setSaved(false)
    try { const data = await productivitySettingsRequest(enabled); setSettings(data); setSaved(true) }
    catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  return <section className="rounded-2xl border border-default-200 bg-content1 p-6 space-y-5">
    <p className="text-sm text-default-500">Control screenshot capture for all employees in your organisation. Turning this off stops new screenshot uploads. Existing records are retained and pending analysis can finish. Attendance continues normally.</p>
    {!settings ? (error ? <div role="alert">{error} <Button onPress={load}>Retry</Button></div> : <p role="status">Loading settings…</p>) : <>
      <Switch isSelected={enabled} isDisabled={busy} onValueChange={value => { setEnabled(value); setSaved(false) }}>Screenshot capture {enabled ? 'on' : 'off'}</Switch>
      <p className="text-sm text-default-500">When enabled, eligible employees are captured every 4 minutes. Admin and HR screens remain excluded.</p>
      {error && <p role="alert" className="text-danger">{error}</p>}
      {saved && <p role="status" className="text-success">Productivity settings saved.</p>}
      <Button color="primary" onPress={save} isLoading={busy} isDisabled={busy || enabled === settings.screenshotsEnabled}>Save changes</Button>
    </>}
  </section>
}
