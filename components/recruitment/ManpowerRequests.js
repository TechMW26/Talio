'use client'

import { useState } from 'react'
import Link from 'next/link'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'

const endpoint = '/api/recruitment/requisitions'
const field = 'w-full rounded-xl border border-default-300 bg-content1 p-3 text-sm text-foreground'
const button = 'rounded-xl border border-default-300 px-4 py-2 text-sm font-medium disabled:opacity-50'
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
    for (const key of ['requirements', 'responsibilities', 'skills', 'benefits']) body[key] = body[key].split('\n').map(v => v.trim()).filter(Boolean)
    onSubmit(body)
  }}>
    <h2 className="text-lg font-semibold">New manpower request</h2>
    <p className="text-sm text-default-500">HR approval publishes these job details. Justification and salary budget stay internal.</p>
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
    <div className="grid gap-4 sm:grid-cols-2">
      {[['justification', 'Business justification (internal)'], ['jobDescription', 'Job description (public)'], ['requirements', 'Requirements (one per line)'], ['responsibilities', 'Responsibilities (one per line)'], ['skills', 'Skills (one per line)'], ['benefits', 'Benefits (optional, one per line)']].map(([name, label]) => <label className="space-y-1 text-sm" key={name}><span>{label}</span><textarea className={field} name={name} rows={4} value={form[name]} onChange={update} required={name !== 'benefits'} maxLength={name === 'jobDescription' ? 15000 : 4000} /></label>)}
    </div>
    <div className="flex gap-2"><button className={button} disabled={busy} type="submit">{busy ? 'Submitting…' : 'Submit to HR'}</button><button className={button} disabled={busy} type="button" onClick={onCancel}>Cancel</button></div>
  </form>
}
function RequestCard({ record, busy, onReview, isHr }) {
  const [review, setReview] = useState('')
  const [reason, setReason] = useState('')
  const job = record.job
  return <article className="space-y-3 rounded-2xl border border-default-200 bg-content1 p-5">
    <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">{job.jobTitle} · {job.numberOfPositions} position(s)</h2><span className="rounded-full bg-default-100 px-3 py-1 text-sm capitalize">{record.status}</span></div>
    <p className="text-sm text-default-500">{record.department?.name} · {record.employee?.firstName} {record.employee?.lastName} · {new Date(record.createdAt).toLocaleDateString()}</p>
    <p className="whitespace-pre-wrap text-sm">{record.justification}</p>
    <details><summary className="cursor-pointer text-sm font-medium">View full job details</summary><div className="mt-3 space-y-3 text-sm">
      <p>{job.location} · {job.workMode} · {job.employmentType} · Education: {job.educationLevel}</p>
      <p>Experience: {job.experience.min}–{job.experience.max} years</p>
      <p>Annual salary budget (internal): {job.salaryRange.currency} {job.salaryRange.min}–{job.salaryRange.max}</p>
      <p className="whitespace-pre-wrap">{job.jobDescription}</p>
      {['requirements', 'responsibilities', 'skills', 'benefits'].map(key => <div key={key}><h3 className="font-medium capitalize">{key}</h3><ul className="list-inside list-disc">{job[key].map((v, i) => <li key={i}>{v}</li>)}</ul></div>)}
    </div></details>
    {record.reviewReason && <p className="text-sm">HR feedback: {record.reviewReason}</p>}
    {record.jobPosting && (isHr ? <Link className="inline-block text-sm underline" href={`/dashboard/recruitment/${record.jobPosting}`}>View published job</Link> : <p className="text-sm">Job published in Talio. HR is managing recruitment.</p>)}
    {record.canReview && <div className="space-y-3">
      <div className="flex gap-2"><button className={button} disabled={busy} onClick={() => setReview('approve')}>Approve & publish</button><button className={button} disabled={busy} onClick={() => setReview('reject')}>Reject</button></div>
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
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')
  const { data, error, isLoading, mutate } = useAuthedSWR(`${endpoint}?page=${page}`, { refreshInterval: 30000 })
  const mutation = useApiMutation({ invalidateKeys: [endpoint, '/api/recruitment'] })
  const save = async body => { setNotice(''); const result = await mutation.execute(endpoint, body); if (result) { setNotice(result.message); setCreating(false); await mutate() } }
  return <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Manpower Requests</h1><p className="text-sm text-default-500">{data?.isHr ? 'Review workforce needs and publish approved openings.' : 'Request manpower and track HR approval.'}</p></div>{data?.canSubmit && !creating && <button className={button} onClick={() => setCreating(true)}>New request</button>}</div>
    {isLoading && <p role="status">Loading requests…</p>}
    {(error || mutation.error) && <div role="alert" className="rounded-xl border border-danger p-3">{mutation.error || error?.message || 'Could not load requests.'}<button className={`${button} ml-2`} onClick={() => mutate()}>Refresh</button></div>}
    {notice && <p role="status" className="rounded-xl bg-success/10 p-3">{notice}</p>}
    {creating && <RequestForm departments={data?.departments || []} busy={mutation.isLoading} onSubmit={save} onCancel={() => setCreating(false)} />}
    {!isLoading && !error && data?.data?.length === 0 && <p className="rounded-xl border border-default-200 p-8 text-center">No manpower requests yet.</p>}
    {data?.data?.map(record => <RequestCard key={`${record._id}-${record.status}`} record={record} isHr={data.isHr} busy={mutation.isLoading} onReview={save} />)}
    {data?.total > 20 && <nav aria-label="Request pages" className="flex items-center gap-3"><button className={button} disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page} of {Math.ceil(data.total / 20)}</span><button className={button} disabled={page * 20 >= data.total} onClick={() => setPage(p => p + 1)}>Next</button></nav>}
  </div>
}
