'use client'
import { Tabs, Tab } from '@/components/ui/fernly'

import { useState } from 'react'
import Link from 'next/link'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import { HiOutlinePlus, HiOutlineBriefcase, HiOutlineClock, HiOutlineCheckCircle, HiOutlineXCircle, HiOutlineInbox, HiOutlineArrowRight, HiOutlineEye, HiOutlineEyeSlash } from 'react-icons/hi2'

const endpoint = '/api/recruitment/requisitions'
const field = 'w-full rounded-xl border border-default-300 bg-content1 p-3 text-sm text-foreground'
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-default-300 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-default-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50'
const primaryButton = `${button} border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-primary/90`
const dangerButton = `${button} border-danger/20 bg-danger/10 text-danger hover:bg-danger/20`
const statuses = { all: 'All requests', pending: 'Pending HR', approved: 'Approved', rejected: 'Rejected' }
const statusTone = { pending: 'bg-warning/10 text-warning', approved: 'bg-success/10 text-success', rejected: 'bg-danger/10 text-danger' }
const defaults = { jobTitle: '', department: '', numberOfPositions: 1, justification: '', jobDescription: '', location: '', employmentType: 'full-time', workMode: 'on-site', educationLevel: 'any', experienceMin: 0, experienceMax: 0, salaryMin: '', salaryMax: '', currency: 'INR', requirements: '', responsibilities: '', skills: '', benefits: '' }
function RequestForm({ departments, busy, onSubmit, onCancel }) {
  const [form, setForm] = useState(defaults)
  const [submissionKey] = useState(() => crypto.randomUUID())
  const update = event => setForm(value => ({ ...value, [event.target.name]: event.target.value }))
  const input = (name, label, type = 'text') => <label className="space-y-1 text-sm" key={name}><span>{label}</span><input className={field} name={name} value={form[name]} onChange={update} type={type} required min={type === 'number' ? (name === 'numberOfPositions' ? 1 : 0) : undefined} max={name === 'numberOfPositions' ? 1000 : undefined} maxLength={200} /></label>
  const select = (name, label, options) => <label className="space-y-1 text-sm" key={name}><span>{label}</span><select className={field} name={name} value={form[name]} onChange={update} required>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
  return <form className="space-y-4 rounded-2xl border border-default-200 bg-content1 p-5" onSubmit={event => {
    event.preventDefault()
    const body = { ...form, submissionKey, action: 'submit' }
    for (const key of ['numberOfPositions', 'experienceMin', 'experienceMax', 'salaryMin', 'salaryMax']) body[key] = Number(body[key])
    for (const key of ['requirements', 'responsibilities', 'benefits']) body[key] = body[key].split('\n').map(v => v.trim()).filter(Boolean)
    body.skills = body.skills.split(/[\n,]+/).map(v => v.trim()).filter(Boolean)
    onSubmit(body)
  }}>
    <h2 className="text-lg font-semibold">New manpower request</h2>
    <p className="text-sm text-default-500">HR approval publishes these job details. Justification and salary budget stay internal.</p>
    <h3 className="border-t border-default-200 pt-4 text-sm font-semibold">Role, headcount &amp; budget</h3>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {input('jobTitle', 'Job title')}
      {select('department', 'Department', [['', 'Choose department'], ...departments.map(d => [d._id, d.name])])}
      {input('numberOfPositions', 'Headcount', 'number')}
      {input('location', 'Location')}
      {select('employmentType', 'Employment type', ['full-time', 'part-time', 'contract', 'internship', 'freelance'].map(v => [v, v]))}
      {select('workMode', 'Work mode', ['on-site', 'remote', 'hybrid'].map(v => [v, v]))}
      {select('educationLevel', 'Education', ['any', 'high-school', 'associate', 'bachelor', 'master', 'doctorate'].map(v => [v, v]))}
      {input('experienceMin', 'Experience: minimum years', 'number')}{input('experienceMax', 'Experience: maximum years', 'number')}
      {input('salaryMin', 'Annual salary budget: minimum', 'number')}{input('salaryMax', 'Annual salary budget: maximum', 'number')}{input('currency', 'Currency (3-letter code)')}
    </div>
    <h3 className="border-t border-default-200 pt-4 text-sm font-semibold">Business case &amp; job requirements</h3>
    <div className="grid gap-4 sm:grid-cols-2">
      {[['justification', 'Business justification (internal)'], ['jobDescription', 'Job description (public)'], ['requirements', 'Requirements (one per line)'], ['responsibilities', 'Responsibilities (one per line)'], ['skills', 'Skills (comma-separated)'], ['benefits', 'Benefits (optional, one per line)']].map(([name, label]) => <label className="space-y-1 text-sm" key={name}><span>{label}</span><textarea className={field} name={name} rows={4} value={form[name]} onChange={update} required={name !== 'benefits'} maxLength={name === 'jobDescription' ? 15000 : 4000} /></label>)}
    </div>
    <div className="flex flex-wrap gap-3 border-t border-default-200 pt-4"><button className={primaryButton} disabled={busy} type="submit">{busy ? 'Submitting…' : 'Submit to HR'}</button><button className={button} disabled={busy} type="button" onClick={onCancel}>Cancel</button></div>
  </form>
}
function RequestCard({ record, busy, onReview, isHr }) {
  const [review, setReview] = useState('')
  const [reason, setReason] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const job = record.job
  const skills = (job.skills || []).flatMap(value => String(value).split(',').map(item => item.trim()).filter(Boolean))
  const fact = (label, value) => value ? (
    <div className="rounded-xl border border-default-200 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-default-500">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  ) : null
  const section = (title, children) => (
    <section className="overflow-hidden rounded-xl border border-default-200">
      <h4 className="border-b border-default-200 bg-default-50 px-4 py-3 text-sm font-semibold">{title}</h4>
      <div className="p-4">{children}</div>
    </section>
  )
  return <article className="space-y-3 rounded-2xl border border-default-200 bg-content1 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="rounded-xl bg-primary/10 p-3 text-primary"><HiOutlineBriefcase className="h-5 w-5" aria-hidden="true" /></span><div><h3 className="text-lg font-semibold">{job.jobTitle}</h3><p className="text-sm text-default-500">{job.numberOfPositions} position(s) · {job.location} · {job.workMode}</p></div></div><span className={`rounded-full px-3 py-1 text-xs font-medium ${statusTone[record.status] || 'bg-default-100'}`}>{statuses[record.status] || record.status}</span></div>
    <p className="text-sm text-default-500">{record.department?.name} · {record.employee?.firstName} {record.employee?.lastName} · {new Date(record.createdAt).toLocaleDateString()}</p>
    <div className="rounded-xl bg-default-50 p-4"><p className="mb-1 text-xs font-medium text-default-500">BUSINESS JUSTIFICATION · INTERNAL</p><p className="whitespace-pre-wrap break-words text-sm">{record.justification}</p></div>
    <div className="border-t border-default-200 pt-4">
      <button type="button" className={button} disabled={busy} onClick={() => setShowDetails(value => !value)}>
        {showDetails ? <HiOutlineEyeSlash className="h-4 w-4" aria-hidden="true" /> : <HiOutlineEye className="h-4 w-4" aria-hidden="true" />}
        {showDetails ? 'Hide job preview' : 'View full job details'}
      </button>
      {showDetails && <div className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fact('Location', job.location)}
          {fact('Work mode', job.workMode)}
          {fact('Employment type', job.employmentType)}
          {fact('Education', job.educationLevel && job.educationLevel !== 'any' ? job.educationLevel : null)}
          {fact('Experience', `${job.experience?.min ?? 0}–${job.experience?.max ?? 0} years`)}
          {fact('Headcount', `${job.numberOfPositions} position(s)`)}
          {fact('Salary budget · internal', job.salaryRange ? `${job.salaryRange.currency} ${job.salaryRange.min}–${job.salaryRange.max}` : null)}
        </div>
        {job.jobDescription && section('Job description', <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{job.jobDescription}</p>)}
        {job.requirements?.length > 0 && section('Requirements', <ul className="list-inside list-disc space-y-1 text-sm">{job.requirements.map((value, index) => <li key={index}>{value}</li>)}</ul>)}
        {job.responsibilities?.length > 0 && section('Responsibilities', <ul className="list-inside list-disc space-y-1 text-sm">{job.responsibilities.map((value, index) => <li key={index}>{value}</li>)}</ul>)}
        {skills.length > 0 && section('Skills', <div className="flex flex-wrap gap-1.5">{skills.map((value, index) => <span key={index} className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{value}</span>)}</div>)}
        {job.benefits?.length > 0 && section('Benefits', <ul className="list-inside list-disc space-y-1 text-sm">{job.benefits.map((value, index) => <li key={index}>{value}</li>)}</ul>)}
      </div>}
    </div>
    {record.reviewReason && <p className="text-sm">HR feedback: {record.reviewReason}</p>}
    {record.jobPosting && (isHr ? <Link className="inline-block text-sm underline" href={`/dashboard/recruitment/${record.jobPosting}`}>View published job</Link> : <p className="text-sm">Job published in Talio. HR is managing recruitment.</p>)}
    {record.canReview && <div className="space-y-3">
      <div className="flex flex-wrap gap-3 border-t border-default-200 pt-4"><button className={primaryButton} disabled={busy} onClick={() => setReview('approve')}>Approve & publish</button><button className={dangerButton} disabled={busy} onClick={() => setReview('reject')}>Reject</button></div>
      {review && <form className="space-y-2" onSubmit={event => { event.preventDefault(); onReview({ action: review, id: record._id, reason }) }}>
        <p className="text-sm">{review === 'approve' ? 'Publish this opening in Talio and make it available to configured recruitment connectors?' : 'Tell the requester why this request is rejected.'}</p>
        {review === 'reject' && <textarea aria-label="Rejection reason" className={field} required minLength={5} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} />}
        <button className={button} disabled={busy}>{busy ? 'Saving…' : 'Confirm'}</button>{' '}<button className={button} type="button" disabled={busy} onClick={() => setReview('')}>Cancel</button>
      </form>}
    </div>}
  </article>
}
export default function ManpowerRequests() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('all')
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')
  const { data, error, isLoading, mutate } = useAuthedSWR(`${endpoint}?page=${page}&status=${status}`, { refreshInterval: 30000 })
  const mutation = useApiMutation({ invalidateKeys: [endpoint, '/api/recruitment'] })
  const save = async body => { setNotice(''); const result = await mutation.execute(endpoint, body); if (result) { setNotice(result.message); setCreating(false); await mutate() } }
  const selectStatus = value => { setStatus(value); setPage(1) }
  const tiles = [['all', HiOutlineBriefcase, 'bg-primary/10 text-primary'], ['pending', HiOutlineClock, statusTone.pending], ['approved', HiOutlineCheckCircle, statusTone.approved], ['rejected', HiOutlineXCircle, statusTone.rejected]]
  return <div className="w-full space-y-6 p-4 text-foreground sm:p-6 lg:p-8">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Manpower Requests</h1><p className="mt-2 text-sm text-default-500">{data?.isHr ? 'Review workforce needs and publish approved openings.' : 'Request manpower and track HR approval.'}</p></div>{data?.canSubmit && !error && !isLoading && !creating && <button className={`${primaryButton} shrink-0`} onClick={() => setCreating(true)}><HiOutlinePlus className="h-5 w-5" aria-hidden="true" />New request</button>}</header>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{tiles.map(([key, Icon, tone]) => <button key={key} type="button" aria-label={`View ${statuses[key].toLowerCase()}`} className="group rounded-2xl border border-default-200 bg-content1 p-4 text-left transition-colors hover:border-default-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:p-5" onClick={() => selectStatus(key)}><div className="flex items-center justify-between gap-2"><span className="text-sm text-default-500">{statuses[key]}</span><span className={`rounded-xl p-2 ${tone}`}><Icon className="h-5 w-5" aria-hidden="true" /></span></div><div className="mt-3 flex items-end justify-between"><strong className="text-3xl font-semibold tabular-nums">{isLoading || error ? '—' : data?.stats?.[key] ?? '—'}</strong><HiOutlineArrowRight className="h-4 w-4 text-default-400 group-hover:text-foreground" aria-hidden="true" /></div></button>)}</div>
    {isLoading && <p role="status">Loading requests…</p>}
    {(error || mutation.error) && <div role="alert" className="rounded-xl border border-danger p-3">{mutation.error || error?.message || 'Could not load requests.'}<button className={`${button} ml-2`} onClick={() => mutate()}>Refresh</button></div>}
    {notice && <p role="status" className="rounded-xl bg-success/10 p-3">{notice}</p>}
    {creating && <RequestForm departments={data?.departments || []} busy={mutation.isLoading} onSubmit={save} onCancel={() => setCreating(false)} />}
    <section className="overflow-hidden rounded-2xl border border-default-200 bg-content1" aria-label="Manpower request list">
    <div className="px-5 pt-5 sm:px-6 sm:pt-6"><Tabs aria-label="Request status" selectedKey={status} onSelectionChange={selectStatus}>{Object.entries(statuses).map(([key, label]) => <Tab key={key} title={label} />)}</Tabs></div>
    <div className="space-y-4 p-5 sm:p-6"><div><h2 className="text-lg font-semibold">{statuses[status]}</h2><p className="mt-1 text-xs text-default-500">{!isLoading && !error && Number.isFinite(data?.total) ? `${data.total} request(s) · ` : ''}Only requests you are authorised to view.</p></div>
    {isLoading && <div className="space-y-3" aria-hidden="true">{[1, 2].map(key => <div key={key} className="h-24 animate-pulse rounded-xl bg-default-100" />)}</div>}
    {!isLoading && !error && data?.data?.length === 0 && <div className="flex min-h-60 flex-col items-center justify-center rounded-xl border border-dashed border-default-200 px-6 py-10 text-center"><span className="mb-4 rounded-2xl bg-default-100 p-4"><HiOutlineInbox className="h-8 w-8 text-default-400" aria-hidden="true" /></span><h3 className="font-semibold">{status === 'all' ? 'No manpower requests yet.' : `No ${status} requests.`}</h3><p className="mt-2 max-w-sm text-sm text-default-500">{status === 'all' ? 'Create a request to share your workforce needs with HR and start the hiring process.' : 'Requests will appear here when they reach this stage.'}</p></div>}
    {data?.data?.map(record => <RequestCard key={`${record._id}-${record.status}`} record={record} isHr={data.isHr} busy={mutation.isLoading} onReview={save} />)}
    {data?.total > 20 && <nav aria-label="Request pages" className="flex items-center gap-3"><button className={button} disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page} of {Math.ceil(data.total / 20)}</span><button className={button} disabled={page * 20 >= data.total} onClick={() => setPage(p => p + 1)}>Next</button></nav>}
    </div></section>
  </div>
}
