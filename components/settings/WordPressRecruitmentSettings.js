'use client'
import { useEffect, useState } from 'react'
import { Button, Input, Select, SelectItem } from '@/components/ui/fernly'
import useAuthedSWR from '@/hooks/useAuthedSWR'

export default function WordPressRecruitmentSettings() {
  const { data, error, isLoading, mutate } = useAuthedSWR('/api/recruitment/wordpress', { refreshInterval: 0, revalidateOnFocus: true })
  const { data: departmentData } = useAuthedSWR('/api/departments')
  const status = data?.data, departments = departmentData?.data || []
  const [siteUrl, setSiteUrl] = useState('https://mushroomworldgroup.com'), [department, setDepartment] = useState('')
  const [token, setToken] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  useEffect(() => { if (status?.configured) { setSiteUrl(status.siteUrl); setDepartment(status.defaultDepartment) } }, [status?.siteUrl, status?.defaultDepartment])
  const save = async action => {
    if (action === 'connect' && status?.configured && !window.confirm('Rotate this connection token? The old token stops working immediately; update WordPress with the new token.')) return
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/recruitment/wordpress', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, siteUrl, defaultDepartment: department }) })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.message || 'Connection could not be saved')
      setToken(result.data.token || ''); await mutate()
      setMessage(action === 'disable' ? 'Connection disabled. WordPress can no longer read or write recruitment records.' : 'Connection created. Copy the endpoint and token into WordPress Settings → Talio Recruitment.')
    } catch (error) { setMessage(error.message) }
    finally { setBusy(false) }
  }
  return <section className="space-y-4 rounded-2xl border border-default-200 bg-content1 p-5">
    <h3 className="text-lg font-semibold">WordPress careers sync</h3>
    <p className="text-sm text-default-500">Connect WP Job Openings to Talio jobs and candidates. This grants the connected site access to this organisation’s recruitment records and resumes, not employee records or internal interview notes.</p>
    {isLoading && <p role="status">Loading connection…</p>}
    {error && <p role="alert">Unable to load the connection. <Button size="sm" onPress={() => mutate()}>Retry</Button></p>}
    <Input label="WordPress website URL" type="url" value={siteUrl} onValueChange={setSiteUrl} isDisabled={busy || status?.configured} />
    <Select label="Default department for website jobs" selectedKeys={department ? [department] : []} onSelectionChange={keys => setDepartment([...keys][0] || '')} isDisabled={busy}>
      {departments.map(item => <SelectItem key={item._id}>{item.name}</SelectItem>)}
    </Select>
    <p className="text-xs text-default-500">Website jobs without a Talio department use this department. Draft jobs stay drafts; open jobs become public on the website. Publishing or editing on either side queues the next sync.</p>
    <div className="flex flex-wrap gap-3"><Button color="primary" isLoading={busy} isDisabled={!department || !siteUrl || !status || busy} onPress={() => save('connect')}>{status?.configured ? 'Rotate token / reconnect' : 'Create connection'}</Button>{status?.enabled && <Button color="danger" variant="flat" isDisabled={busy} onPress={() => save('disable')}>Disable connection</Button>}</div>
    {status?.configured && <div className="space-y-2 rounded-xl bg-default-100 p-4 text-sm"><p>Status: {status.enabled ? (status.lastSeenAt ? 'Connected' : 'Awaiting WordPress setup') : 'Disabled'}</p><p>Last contact: {status.lastSeenAt ? new Date(status.lastSeenAt).toLocaleString() : 'Not yet connected'}</p><p>Last completed run: {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : 'Not yet synced'}</p>{status.lastError && <p className="text-danger">{status.lastError}</p>}<Input label="Connection endpoint" isReadOnly value={`${typeof window !== 'undefined' ? window.location.origin : ''}${status.endpointPath}`} /></div>}
    {token && <div className="space-y-2 rounded-xl border border-warning-300 p-4"><Input label="One-time connection token" type="password" isReadOnly value={token} /><Button size="sm" onPress={async () => { try { await navigator.clipboard.writeText(token); setMessage('Token copied. Store it only in the WordPress connector settings.') } catch { setMessage('Clipboard unavailable. Select and copy the token field.') } }}>Copy token</Button><p className="text-xs">Shown only in this session. Do not share it in email, logs or screenshots.</p></div>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <p className="text-xs text-default-500">Install the Talio Recruitment Sync companion plugin alongside your TalentLens plugin. Use its import/rescan button to bring over existing records. Sync runs through WordPress cron; configure a one-minute hosting cron for reliable timing.</p>
  </section>
}
