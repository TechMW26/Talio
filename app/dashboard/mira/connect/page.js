'use client'

import { useEffect, useState } from 'react'

export default function MiraConnectionsPage() {
  const [code, setCode] = useState(''), [data, setData] = useState(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState('')
  async function request(method, input) {
    const response = await fetch('/api/mira/link/consent' + (method === 'GET' && input ? '?user_code=' + encodeURIComponent(input) : ''), {
      method, headers: { 'Content-Type': 'application/json', ...(localStorage.getItem('token') ? { Authorization: 'Bearer ' + localStorage.getItem('token') } : {}) },
      ...(method !== 'GET' ? { body: JSON.stringify(input) } : {}), cache: 'no-store',
    })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || 'Could not load this connection.')
    return body
  }
  async function load(value = '') {
    setBusy(true); setError(''); setData(null); setResult('')
    try { setData({ ...await request('GET', value), reviewedCode: value }) } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  useEffect(() => { const initial = new URL(window.location.href).searchParams.get('user_code') || ''; setCode(initial); load(initial) }, [])
  async function decide(approve) {
    setBusy(true); setError('')
    try { if (!data?.reviewedCode || data.reviewedCode !== code) throw new Error('Review this code before approving it.'); await request('POST', { userCode: data.reviewedCode, approve }); setResult(approve ? 'Approved. Return to the MIRA window that displayed this code.' : 'Request declined. No workplace access was granted.'); setData(null) }
    catch (error) { setError(error.message) } finally { setBusy(false) }
  }
  async function revoke(id) {
    setBusy(true); setError('')
    try { await request('DELETE', { id }); await load() } catch (error) { setError(error.message) } finally { setBusy(false) }
  }
  return <main className="mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-8">
    <div><h1 className="text-2xl font-semibold">Connect standalone MIRA</h1><p className="mt-2 text-sm text-default-500">Your accounts stay separate. Only approve a code shown in a MIRA window you are using.</p></div>
    <form className="flex flex-wrap gap-3" onSubmit={event => { event.preventDefault(); load(code) }}>
      <label className="flex-1 min-w-48 text-sm">MIRA connection code<input disabled={busy} aria-label="MIRA connection code" value={code} onChange={event => { setCode(event.target.value); setData(null); setResult('') }} maxLength={11} autoComplete="off" className="mt-2 w-full rounded-xl border border-default-200 bg-content1 p-3 font-mono uppercase" placeholder="ABCDE-12345" /></label>
      <button type="submit" disabled={busy || !code} className="self-end rounded-xl bg-primary px-4 py-3 text-primary-foreground disabled:opacity-50">Review request</button>
    </form>
    {busy && <p role="status" className="text-sm">Checking connection…</p>}
    {error && <p role="alert" className="rounded-xl border border-danger-300 p-4 text-sm text-danger">{error}</p>}
    {result && <p role="status" className="rounded-xl border border-success-300 p-4 text-sm">{result}</p>}
    {data?.request && <section className="space-y-4 rounded-2xl border border-default-200 bg-content1 p-5">
      <h2 className="font-semibold">Standalone MIRA is requesting access</h2>
      <p className="text-sm">Talio account: {data.account.name}<br />Company: {data.account.company || 'Your Talio organization'}</p>
      <ul className="list-disc space-y-2 pl-5 text-sm"><li>Read your permitted personal workplace tasks, projects, meetings, attendance, leave and attention feed.</li>{data.request.scopes.includes('workplace:act') && <li>Perform supported workplace actions after a separate confirmation for each action. Your current Talio role still applies.</li>}</ul>
      <p className="text-sm text-default-500">Expires after 30 days. Revoke here at any time. Requested context may be sent to MIRA’s configured AI provider to answer you; workplace replies are encrypted before history sync. This does not merge accounts or share your Talio password.</p>
      {data.request.status === 'pending' ? <div className="flex gap-3"><button disabled={busy} onClick={() => decide(true)} className="rounded-xl bg-primary px-5 py-3 text-primary-foreground disabled:opacity-50">Allow connection</button><button disabled={busy} onClick={() => decide(false)} className="rounded-xl border border-default-200 px-5 py-3">Decline</button></div> : <p role="status">This request has already been {data.request.status}. Start a new connection from MIRA if needed.</p>}
    </section>}
    {data && <section className="space-y-3 rounded-2xl border border-default-200 p-5"><h2 className="font-semibold">Active MIRA connections</h2>{!data.grants?.length && <p className="text-sm text-default-500">No standalone MIRA connections.</p>}{data.grants?.map(grant => <div key={grant.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-default-200 pt-3"><div className="text-sm">Standalone MIRA · {grant.scopes.includes('workplace:act') ? 'Read and confirmed actions' : 'Read only'}<p className="text-xs text-default-500">Expires {new Date(grant.expiresAt).toLocaleDateString()}</p></div><button disabled={busy} onClick={() => revoke(grant.id)} className="rounded-xl border border-danger-200 px-3 py-2 text-sm text-danger">Revoke access</button></div>)}</section>}
  </main>
}
