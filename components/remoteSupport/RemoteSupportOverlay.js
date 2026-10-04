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

export default function RemoteSupportOverlay() {
  const [session, setSession] = useState(null)
  const [error, setError] = useState('')

  const refresh = useCallback(async signal => {
    if (!getToken()) return
    try {
      const result = await request('/api/remote-support/sessions', { signal })
      if (signal.aborted) return
      const employeeSessions = (result.sessions || []).filter(item => item.side === 'employee' && ['pending', 'approved'].includes(item.status))
      setSession(employeeSessions[0] || null)
      setError('')
    } catch { /* transient auth/network errors are retried on the next poll */ }
  }, [])

  useEffect(() => {
    let stopped = false, timer, controller, deadline
    const poll = async () => {
      controller = new AbortController()
      deadline = window.setTimeout(() => controller.abort(), 20000)
      try { await refresh(controller.signal) }
      finally {
        window.clearTimeout(deadline)
        // Schedule from completion: a slow cloud read must never accumulate
        // concurrent background polls and starve page navigation/asset loads.
        if (!stopped) timer = window.setTimeout(poll, 3500)
      }
    }
    void poll()
    return () => { stopped = true; window.clearTimeout(timer); window.clearTimeout(deadline); controller?.abort() }
  }, [refresh])

  const decide = async action => {
    if (!session) return
    setError('')
    try {
      const result = await request(`/api/remote-support/sessions/${session.id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
      if (action === 'approve') setSession(result.session)
      else setSession(null)
    } catch (err) { setError(err.message || 'Could not update the request.') }
  }

  if (!session) return null
  if (session.status === 'approved') {
    return <RemoteSupportSessionView session={session} side="employee" onSessionChange={setSession} onClose={() => setSession(null)} />
  }

  return (
    <div className="fixed bottom-4 right-4 z-[10000] w-[min(440px,calc(100vw-2rem))] rounded-2xl border border-amber-400/60 bg-zinc-950 p-5 text-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="remote-support-title">
      <div className="flex items-start justify-between gap-3"><div><h2 id="remote-support-title" className="text-lg font-semibold">Remote support request</h2><p className="mt-1 text-sm text-zinc-300">{session.requestedByName} wants to connect to MIRA on this device.</p></div><span className="rounded-full bg-amber-400/15 px-2 py-1 text-xs text-amber-200">Pending</span></div>
      <p className="mt-4 rounded-lg bg-white/5 p-3 text-sm"><span className="font-semibold">Reason:</span> {session.reason}</p>
      <p className="mt-3 text-xs leading-5 text-zinc-400">Approving allows this administrator to relay commands to your MIRA and request a live screen share for up to 30 minutes. Your screen is not captured unless you separately choose displays and start sharing. A visible indicator stays on, and you can stop the session at any time.</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      <div className="mt-4 flex justify-end gap-2"><button onClick={() => decide('decline')} className="rounded-lg border border-white/15 px-4 py-2 text-sm">Decline</button><button onClick={() => decide('approve')} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold">Approve session</button></div>
    </div>
  )
}
