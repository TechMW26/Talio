'use client'

import { useCallback, useEffect, useState } from 'react'
import { getToken } from '@/utils/userHelper'
import RemoteSupportSessionView from '@/components/remoteSupport/RemoteSupportSessionView'

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    cache: 'no-store',
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.success) throw new Error(result.message || 'Remote support request failed.')
  return result
}

export default function RemoteSupportAdminPanel({ employeeId, employeeName }) {
  const [reason, setReason] = useState('')
  const [session, setSession] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try {
      const result = await request('/api/remote-support/sessions')
      const current = (result.sessions || []).find(item => item.side === 'administrator' && item.targetEmployeeId === String(employeeId) && ['pending', 'approved'].includes(item.status))
      setSession(current || null)
    } catch { /* admin-only API will return an explicit error on submit */ }
  }, [employeeId])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(refresh, 4000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const createRequest = async event => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const result = await request('/api/remote-support/sessions', { method: 'POST', body: JSON.stringify({ employeeId, reason }) })
      setSession(result.session)
      setReason('')
    } catch (err) { setError(err.message || 'Could not send the request.') }
    finally { setBusy(false) }
  }

  if (session?.status === 'approved') return <RemoteSupportSessionView session={session} side="administrator" onSessionChange={setSession} onClose={() => setSession(null)} />

  return <section className="mt-6 rounded-2xl border border-sky-500/20 bg-white p-5 dark:border-sky-500/20 dark:bg-zinc-950" aria-label="Remote support">
    <h2 className="font-semibold text-slate-900 dark:text-zinc-100">Remote support with MIRA</h2>
    {session?.status === 'pending' ? <p className="mt-2 text-sm text-slate-600 dark:text-zinc-400">Request sent to {employeeName}. Screen sharing and command relay stay unavailable until the employee approves.</p> : <form onSubmit={createRequest} className="mt-3 space-y-3">
      <label className="block text-sm text-slate-600 dark:text-zinc-400" htmlFor="remote-support-reason">Reason for support request</label>
      <textarea id="remote-support-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} minLength={5} required rows={2} placeholder="Describe the support needed" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-white" />
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <button type="submit" disabled={busy || reason.trim().length < 5} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Sending…' : `Request MIRA session with ${employeeName}`}</button>
    </form>}
  </section>
}
