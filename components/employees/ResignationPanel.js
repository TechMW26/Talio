'use client'

import { useEffect, useRef, useState } from 'react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import ResignationExitPanel from './ResignationExitPanel'

const labels = { hr_review: 'Awaiting HR approval', hierarchy_review: 'Awaiting hierarchy notice proposal', hr_relay: 'Proposal awaiting HR review', employee_review: 'Awaiting employee decision', negotiation_hr: 'Negotiation awaiting HR', accepted: 'Notice period accepted', completed: 'Exit completed · Resigned', rejected: 'Request declined', withdrawn: 'Withdrawn' }
const actionLabels = { approve: 'Approve & send to hierarchy', reject: 'Decline request', propose: 'Propose notice period', relay: 'Send proposal to employee', return: 'Request revised proposal', forward_negotiation: 'Send negotiation to hierarchy', accept: 'Accept notice period', negotiate: 'Negotiate notice period', withdraw: 'Withdraw resignation', submit: 'Submit resignation' }
const field = 'w-full rounded-xl border border-default-300 bg-content1 p-3 text-sm text-foreground'
const button = 'rounded-xl border border-default-300 px-4 py-2 text-sm font-medium disabled:opacity-50'
const dateLabel = value => value ? new Date(value).toLocaleDateString('en-GB', { timeZone: 'UTC' }) : '—'

function RequestCard({ record, busy, onAction, canManageExits, onUpdated }) {
  const [action, setAction] = useState('')
  const [reason, setReason] = useState('')
  const [days, setDays] = useState(record.proposal?.noticeDays ?? 30)
  const [start, setStart] = useState(record.proposal?.noticeStartDate?.slice(0, 10) || new Date().toISOString().slice(0, 10))
  const needsReason = ['propose', 'negotiate', 'return', 'reject'].includes(action)
  const proposedEnd = /^\d{4}-\d{2}-\d{2}$/.test(start) && days !== '' && Number.isInteger(Number(days)) && Number(days) >= 0 && Number(days) <= 365 ? new Date(new Date(`${start}T00:00:00Z`).getTime() + Number(days) * 86400000) : null
  return <article id={`resignation-${record._id}`} className="space-y-3 rounded-xl border border-default-200 p-4">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{record.own ? 'Your resignation' : `${record.employee?.firstName || ''} ${record.employee?.lastName || ''}`} <span className="text-sm text-default-500">{record.employee?.employeeCode}</span></h3><span className="text-sm font-medium">{labels[record.status]}</span></div>
    <p className="text-xs text-default-500">Submitted {dateLabel(record.createdAt)}</p>
    <p className="whitespace-pre-wrap break-words text-sm">{record.reason}</p>
    {record.proposal?.lastWorkingDate && <div className="rounded-lg bg-default-100 p-3 text-sm"><p>Proposed notice: <strong>{record.proposal.noticeDays} calendar days</strong></p><p>Starts: {dateLabel(record.proposal.noticeStartDate)} · Last working date: {dateLabel(record.proposal.lastWorkingDate)}</p><p className="whitespace-pre-wrap break-words">{record.proposal.reason}</p></div>}
    {record.status === 'accepted' && <p className="text-sm text-default-500">Notice period agreed. HR will complete handover and full-and-final settlement below; your account remains active until exit finalisation.</p>}
    {['accepted', 'completed'].includes(record.status) && (canManageExits || record.own) && <ResignationExitPanel record={record} onUpdated={onUpdated} />}
    <div className="flex flex-wrap gap-2">{record.actions.map(value => <button type="button" key={value} disabled={busy} className={button} onClick={() => { setAction(value); setReason('') }}>{actionLabels[value]}</button>)}</div>
    {action && <form className="space-y-3 rounded-xl bg-default-100 p-3" onSubmit={async event => { event.preventDefault(); if (await onAction({ id: record._id, version: record.version, action, reason, noticeDays: Number(days), noticeStartDate: start })) setAction('') }}>
      <p className="font-medium">Confirm: {actionLabels[action]}</p>
      {action === 'propose' && <><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Notice period (calendar days)<input className={field} type="number" min="0" max="365" step="1" required value={days} onChange={e => setDays(e.target.value)} /></label><label className="text-sm">Notice start date<input className={field} type="date" min={record.createdAt.slice(0, 10)} required value={start} onChange={e => setStart(e.target.value)} /></label></div><p className="text-xs">Last working date: {proposedEnd && Number.isFinite(proposedEnd.getTime()) ? dateLabel(proposedEnd) : 'Choose a valid period'}. Calculated as start date + notice days; 0 means same-day release.</p></>}
      {needsReason && <label className="block text-sm">{action === 'negotiate' ? 'Requested change and reason' : 'Reason / review notes'}<textarea className={field} required minLength={5} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label>}
      {action === 'accept' && <p className="text-sm">You are accepting {record.proposal?.noticeDays} days of notice, with a last working date of {dateLabel(record.proposal?.lastWorkingDate)}.</p>}
      <div className="flex gap-2"><button className={`${button} bg-primary text-primary-foreground`} disabled={busy}>{busy ? 'Saving…' : 'Confirm'}</button><button type="button" className={button} disabled={busy} onClick={() => setAction('')}>Cancel</button></div>
    </form>}
    <details><summary className="cursor-pointer text-sm">Request history ({record.timeline.length})</summary><ol className="mt-3 space-y-3">{record.timeline.map((event, index) => <li key={index} className="border-l-2 border-default-200 pl-3 text-sm"><p>{actionLabels[event.action] || event.action} · {new Date(event.at).toLocaleString()}</p><p className="text-xs text-default-500">{event.actor?.email || 'Team member'}</p>{event.reason && <p className="whitespace-pre-wrap break-words">{event.reason}</p>}{event.lastWorkingDate && <p>{event.noticeDays} days · Last working date {dateLabel(event.lastWorkingDate)}</p>}</li>)}</ol></details>
  </article>
}

export default function ResignationPanel({ requestId, initialView = 'mine' }) {
  const { data, error, isLoading, mutate } = useAuthedSWR('/api/resignations', { refreshInterval: 15000 })
  const [view, setView] = useState(initialView)
  useEffect(() => { setView(['overview', 'mine', 'reviews', 'offboarding', 'completed'].includes(initialView) ? initialView : 'overview') }, [initialView])
  const [composing, setComposing] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState('')
  const mutation = useApiMutation({ invalidateKeys: ['/api/resignations'] })
  const records = data?.data || []
  const openedRequest = useRef(null)
  useEffect(() => {
    const target = data?.data?.find(r => r._id === requestId)
    if (!target || openedRequest.current === requestId) return
    openedRequest.current = requestId
    setView(target.status === 'completed' ? 'completed' : target.status === 'accepted' ? 'offboarding' : target.own ? 'mine' : 'reviews')
    document.getElementById('resignations')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [requestId, data])
  const own = records.filter(r => r.own), reviews = records.filter(r => !r.own)
  const pending = reviews.filter(r => !['accepted', 'completed', 'rejected', 'withdrawn'].includes(r.status))
  const offboarding = records.filter(r => r.status === 'accepted')
  const completed = records.filter(r => r.status === 'completed')
  const visible = view === 'mine' ? own : view === 'reviews' ? pending : view === 'offboarding' ? offboarding : view === 'completed' ? completed : records.filter(r => r.actions.length > 0)
  const hasActive = own.some(r => r.active)
  const save = async input => {
    setMessage('')
    const result = await mutation.execute('/api/resignations', input)
    if (!result?.success) return false
    setMessage(result.message); setComposing(false); setReason(''); setConfirmed(false); await mutate(); return true
  }
  return <section id="resignations" className="mt-6 space-y-4 rounded-3xl border border-default-200 bg-content1 p-5 text-foreground" aria-label="Resignation requests">
    <h2 className="text-lg font-semibold">Resignation dashboard</h2>
    <p className="text-sm text-default-500">Submit to HR, review your proposed notice period, or negotiate before accepting.</p>
    <div className="flex flex-wrap gap-2">{Object.entries({ overview: 'Overview', mine: 'My requests', reviews: `Review inbox (${pending.length})`, offboarding: `F&F / Offboarding (${offboarding.length})`, completed: `Completed (${completed.length})` }).map(([key, label]) => <button key={key} type="button" className={`${button} ${view === key ? 'bg-primary text-primary-foreground' : ''}`} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}</div>
    {view === 'overview' && <><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[['My requests', own.length, 'mine'], ['Pending approvals', pending.length, 'reviews'], ['F&F in progress', offboarding.length, 'offboarding'], ['Completed exits', completed.length, 'completed']].map(([label, count, tab]) => <button key={tab} className="rounded-xl border border-default-200 p-4 text-left" onClick={() => setView(tab)}><span className="text-sm text-default-500">{label}</span><strong className="mt-2 block text-2xl">{count}</strong></button>)}</div><h3 className="font-semibold">Needs your action</h3><p className="text-xs text-default-500">Counts reflect requests you are authorised to view.</p></>}
    {isLoading && <p role="status">Loading resignation requests…</p>}
    {error && <p role="alert">Unable to load requests. <button className={button} onClick={() => mutate()}>Retry</button></p>}
    {mutation.error && <p role="alert" className="text-danger">{mutation.error} <button className={button} onClick={() => mutate()}>Refresh requests</button></p>}
    {message && <p role="status">{message}</p>}
    {!isLoading && !error && <>
      {view === 'mine' && !hasActive && data?.canSubmit && !composing && <button type="button" className={button} onClick={() => setComposing(true)}>Submit resignation</button>}
      {view === 'mine' && composing && !hasActive && <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (confirmed) save({ action: 'submit', reason }) }}><label className="block text-sm">Reason for resignation<textarea className={field} value={reason} onChange={e => setReason(e.target.value)} required minLength={5} maxLength={2000} /></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required />I understand this submits a formal resignation request to HR.</label><div className="flex gap-2"><button className={`${button} bg-danger text-white`} disabled={mutation.isLoading || !confirmed}>Submit to HR</button><button type="button" className={button} disabled={mutation.isLoading} onClick={() => setComposing(false)}>Cancel</button></div></form>}
      {visible.length === 0 && <p className="text-sm text-default-500">{view === 'mine' ? 'No resignation requests.' : 'No requests in this view.'}</p>}
      {visible.map(record => <RequestCard key={`${record._id}:${record.version}`} record={record} busy={mutation.isLoading} onAction={save} canManageExits={data?.canManageExits} onUpdated={mutate} />)}
    </>}
  </section>
}
