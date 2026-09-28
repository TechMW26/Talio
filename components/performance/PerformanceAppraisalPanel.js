'use client'

import { useState } from 'react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import toast from '@/utils/toast'

const initialPeriod = () => {
  const now = new Date()
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return `FY ${year}-${String(year + 1).slice(-2)}`
}

const STATUS_LABELS = {
  pending_approval: 'Pending approval',
  hr_discussion: 'HR discussion',
  approved: 'Finalized · approved',
  rejected: 'Declined',
}

function displayName(value) {
  if (!value) return 'Unassigned'
  return `${value.firstName || ''} ${value.lastName || ''}`.trim() || value.email || 'Reviewer'
}

function roleLabel(role = '') {
  return role === 'hr' ? 'HR' : role.replaceAll('_', ' ')
}

function validDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function RequestCard({ record, onAction, busy }) {
  const [comment, setComment] = useState('')
  const [outcome, setOutcome] = useState('')
  const current = record.currentStep
  const hrStage = current?.role === 'hr'
  const progress = record.approvalSteps?.length
    ? `${record.approvalSteps.filter((step) => step.status !== 'pending').length} / ${record.approvalSteps.length}`
    : '—'
  const isFinalized = ['approved', 'rejected'].includes(record.status)
  const requester = displayName(record.requestedByEmployee) !== 'Unassigned'
    ? displayName(record.requestedByEmployee)
    : record.requestedByUser?.email || 'Reviewer'
  const timelineLabels = {
    submitted: 'Submitted',
    approved: 'Approved and forwarded',
    rejected: 'Declined',
    hr_discussion_completed: 'HR discussion completed',
  }

  return (
    <article className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900 dark:text-zinc-100">
            {record.employee ? `${record.employee.firstName} ${record.employee.lastName || ''}`.trim() : 'Employee'}
          </h3>
          <p className="text-sm text-slate-500 dark:text-zinc-400">
            {record.employee?.employeeCode ? `${record.employee.employeeCode} · ` : ''}{record.reviewPeriod}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-zinc-500">
            Raised by {requester}{record.createdAt ? ` · ${new Date(record.createdAt).toLocaleDateString()}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-indigo-50 dark:bg-indigo-950/50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
            {record.proposedIncreasePercent}% proposed
          </span>
          <span className="rounded-full bg-slate-100 dark:bg-zinc-800 px-3 py-1 text-xs font-semibold text-slate-700 dark:text-zinc-300">
            {STATUS_LABELS[record.status] || record.status}
          </span>
        </div>
      </div>

      <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-zinc-300">{record.reason}</p>
      {record.pointers?.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-zinc-400">Supporting pointers</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-zinc-300">
            {record.pointers.map((pointer, index) => <li key={`${index}-${pointer}`}>{pointer}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-4 rounded-xl bg-slate-50 dark:bg-zinc-900/80 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-slate-600 dark:text-zinc-300">Approval path · {progress}</span>
          <span className="text-slate-500 dark:text-zinc-400">Stage: {isFinalized ? 'Complete' : roleLabel(current?.role) || STATUS_LABELS[record.status]}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(record.approvalSteps || []).map((step, index) => (
            <span key={`${step.role}-${index}`} className={`rounded-full border px-2.5 py-1 text-xs ${step.status === 'approved' ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300' : step.status === 'rejected' ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300' : index === record.currentStepIndex ? 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300' : 'border-slate-200 text-slate-500 dark:border-zinc-700 dark:text-zinc-400'}`}>
              {roleLabel(step.role)}
              {step.approverEmployee ? ` · ${displayName(step.approverEmployee)}` : ''}
              {step.status !== 'pending' ? ` · ${step.status}` : ''}
            </span>
          ))}
        </div>
        {(record.approvalSteps || []).some((step) => step.comment) && (
          <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 dark:border-zinc-800">
            {record.approvalSteps.map((step, index) => step.comment ? (
              <p key={`comment-${index}`} className="text-xs leading-5 text-slate-600 dark:text-zinc-400">
                <span className="font-semibold capitalize">{roleLabel(step.role)}:</span> {step.comment}
              </p>
            ) : null)}
          </div>
        )}
      </div>

      {record.canAct && (
        <div className="mt-4 border-t border-slate-100 dark:border-zinc-800 pt-4">
          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-zinc-300">
            {hrStage ? 'HR discussion notes' : 'Reviewer comment'}{hrStage ? ' (required)' : ''}
          </label>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={hrStage ? 'Record the discussion and decision rationale…' : 'Add context (required when declining)…'}
            className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          {hrStage ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="text-sm text-slate-600 dark:text-zinc-300" htmlFor={`outcome-${record._id}`}>Outcome</label>
              <select id={`outcome-${record._id}`} value={outcome} onChange={(event) => setOutcome(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
                <option value="">Choose an outcome…</option>
                <option value="approved">Recommendation approved</option>
                <option value="rejected">Recommendation declined</option>
              </select>
              <button type="button" disabled={busy || !outcome || comment.trim().length < 5} onClick={() => onAction(record, 'complete_discussion', comment, outcome)} className="ml-auto rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? 'Saving…' : 'Complete HR discussion'}
              </button>
            </div>
          ) : (
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" disabled={busy || !comment.trim()} onClick={() => onAction(record, 'reject', comment)} className="rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300">
                Decline
              </button>
              <button type="button" disabled={busy} onClick={() => onAction(record, 'approve', comment)} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? 'Saving…' : 'Approve & forward'}
              </button>
            </div>
          )}
        </div>
      )}

      {record.timeline?.length > 0 && (
        <details className="mt-4 rounded-xl border border-slate-200 dark:border-zinc-800">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700 dark:text-zinc-300">
            Activity history ({record.timeline.length})
          </summary>
          <ol className="space-y-3 border-t border-slate-200 px-4 py-3 dark:border-zinc-800">
            {record.timeline.map((event, index) => {
              const eventDate = validDate(event.at)
              return (
                <li key={event._id || `${event.type}-${event.at || index}`} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800 dark:text-zinc-200">
                      {timelineLabels[event.type] || event.type.replaceAll('_', ' ')}
                      {event.actor?.role ? ` · ${roleLabel(event.actor.role)}` : event.role ? ` · ${roleLabel(event.role)}` : ''}
                      {event.actor?.email ? ` · ${event.actor.email}` : ''}
                    </p>
                    {event.message && <p className="mt-0.5 whitespace-pre-wrap text-slate-600 dark:text-zinc-400">{event.message}</p>}
                    {eventDate && (
                      <time className="mt-0.5 block text-xs text-slate-500 dark:text-zinc-500" dateTime={eventDate.toISOString()}>
                        {eventDate.toLocaleString()}
                      </time>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </details>
      )}

      {record.hrDiscussion?.notes && (
        <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/70 p-3 text-sm dark:border-indigo-900/60 dark:bg-indigo-950/30">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">HR discussion · {record.hrDiscussion.outcome}</p>
          <p className="whitespace-pre-wrap text-slate-700 dark:text-zinc-300">{record.hrDiscussion.notes}</p>
        </div>
      )}
    </article>
  )
}

export default function PerformanceAppraisalPanel({ employeeId = null, employeeName = '' }) {
  const key = employeeId ? `/api/performance/appraisals?employeeId=${encodeURIComponent(employeeId)}` : '/api/performance/appraisals'
  const { data, error, isLoading, mutate } = useAuthedSWR(key)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [activeActionId, setActiveActionId] = useState(null)
  const [form, setForm] = useState({ reviewPeriod: initialPeriod(), proposedIncreasePercent: '', reason: '', pointers: '' })
  const records = data?.data || []
  const canCreate = Boolean(employeeId && data?.permissions?.canCreate)

  const submitRequest = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      const response = await fetch('/api/performance/appraisals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: JSON.stringify({
          employeeId,
          reviewPeriod: form.reviewPeriod,
          proposedIncreasePercent: form.proposedIncreasePercent,
          reason: form.reason,
          pointers: form.pointers.split(/\r?\n/),
        }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.message || 'Could not submit the appraisal request')
      toast.success(result.message || 'Appraisal request submitted')
      setShowForm(false)
      setForm({ reviewPeriod: initialPeriod(), proposedIncreasePercent: '', reason: '', pointers: '' })
      await mutate()
    } catch (submitError) {
      toast.error(submitError.message || 'Could not submit the appraisal request')
    } finally {
      setSubmitting(false)
    }
  }

  const takeAction = async (record, action, comment, outcome) => {
    setActiveActionId(record._id)
    try {
      const response = await fetch(`/api/performance/appraisals/${record._id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: JSON.stringify({ action, comment, outcome }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.message || 'Could not save the review')
      toast.success(result.message || 'Review saved')
      await mutate()
    } catch (actionError) {
      toast.error(actionError.message || 'Could not save the review')
    } finally {
      setActiveActionId(null)
    }
  }

  return (
    <section className="mt-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100">Performance appraisals</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
            {employeeId ? `Recommendations and approval history for ${employeeName || 'this employee'}.` : 'Review requests routed to you and track the appraisal workflow.'}
            {' '}The proposed percentage is a recommendation; it does not change payroll.
          </p>
        </div>
        {canCreate && !showForm && (
          <button type="button" onClick={() => setShowForm(true)} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">Raise appraisal request</button>
        )}
      </div>

      {showForm && (
        <form onSubmit={submitRequest} className="space-y-4 rounded-2xl border border-sky-200 bg-sky-50/60 p-5 dark:border-sky-900/70 dark:bg-sky-950/20">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-zinc-100">New appraisal recommendation</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">This will be routed through the employee’s remaining reporting tiers and then to HR.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700 dark:text-zinc-300">Review period
              <input required maxLength={80} value={form.reviewPeriod} onChange={(event) => setForm({ ...form, reviewPeriod: event.target.value })} placeholder="FY 2026-27 / H1 2026" className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
            </label>
            <label className="text-sm font-medium text-slate-700 dark:text-zinc-300">Proposed appraisal percentage
              <div className="relative mt-1">
                <input required type="number" min="0" max="100" step="0.01" value={form.proposedIncreasePercent} onChange={(event) => setForm({ ...form, proposedIncreasePercent: event.target.value })} placeholder="e.g. 8" className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-10 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
                <span className="absolute right-3 top-2 text-sm text-slate-500">%</span>
              </div>
            </label>
          </div>
          <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300">Reason for recommendation
            <textarea required minLength={10} maxLength={4000} rows={4} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Summarize the business rationale and impact…" className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300">Supporting performance pointers (one per line)
            <textarea required rows={4} maxLength={6500} value={form.pointers} onChange={(event) => setForm({ ...form, pointers: event.target.value })} placeholder={'Delivered project X ahead of schedule\nExceeded quarterly target by …\nRecognized customer impact …'} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-zinc-700 dark:text-zinc-300">Cancel</button>
            <button type="submit" disabled={submitting} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{submitting ? 'Submitting…' : 'Submit for review'}</button>
          </div>
        </form>
      )}

      {isLoading ? <div className="rounded-2xl border border-slate-200 p-6 text-sm text-slate-500 dark:border-zinc-800 dark:text-zinc-400">Loading appraisal requests…</div> : null}
      {error ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">Could not load appraisal requests. Please refresh and try again.</div> : null}
      {!isLoading && !error && records.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-zinc-700 dark:text-zinc-400">
          No appraisal requests yet.{canCreate ? ' You can raise the first recommendation above.' : ''}
        </div>
      )}
      <div className="space-y-4">
        {records.map((record) => <RequestCard key={record._id} record={record} onAction={takeAction} busy={activeActionId === record._id} />)}
      </div>
    </section>
  )
}
