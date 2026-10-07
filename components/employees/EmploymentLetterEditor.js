'use client'

import { useEffect, useState } from 'react'
import { Button, Input, Textarea } from '@/components/ui/fernly'
import { LETTER_FIELDS, employmentLetterParagraphs, validateEmploymentLetter } from '@/lib/hrms/employmentLetter'
import { requestEmploymentLetter } from '@/lib/client/employmentLetter'
import { downloadDocumentFile, fetchDocumentFile } from '@/lib/client/documentFile'
import toast from '@/utils/toast'

export default function EmploymentLetterEditor({ employeeId }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState('appointment')
  const [context, setContext] = useState(null)
  const [fields, setFields] = useState({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [logo, setLogo] = useState('')
  const [saved, setSaved] = useState(null)
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true); setError(''); setContext(null); setSaved(null)
    requestEmploymentLetter(employeeId, { kind }).then(result => {
      if (!active) return
      setContext(result.data)
      setFields({ ...result.data.defaults, ...result.data.latest?.generatedLetter?.fields })
      setSaved(result.data.latest)
    }).catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, kind, employeeId, attempt])
  useEffect(() => {
    setLogo('')
    if (!context?.logo) return
    if (/^data:image\/(png|jpeg|webp);base64,/i.test(context.logo)) { setLogo(context.logo); return }
    let active = true, url
    fetchDocumentFile(context.logo).then(blob => {
      if (active) { url = URL.createObjectURL(blob); setLogo(url) }
    }).catch(() => {})
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [context?.logo])
  let invalid = ''
  try { validateEmploymentLetter(kind, fields) } catch (error) { invalid = error.message }

  const issue = async sendEmail => {
    setBusy(sendEmail ? 'email' : 'download'); setError('')
    try {
      const result = await requestEmploymentLetter(employeeId, { kind, fields, sendEmail })
      setSaved(result.data)
      if (result.warning) { setError(result.warning); toast.error(result.warning) }
      else toast.success(result.message)
      if (!sendEmail) await downloadDocumentFile(result.data)
    } catch (error) { setError(error.message); toast.error(error.message) }
    finally { setBusy('') }
  }
  return <div className="mt-4 rounded-2xl border border-default-200 p-4 sm:p-5 space-y-4">
    <Button variant="flat" onPress={() => setOpen(!open)}>Prepare offer / appointment letter</Button>
    {open && <>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium">Letter type <select aria-label="Letter type" className="ml-2 rounded-lg border border-default-200 bg-default-100 p-2" disabled={loading || Boolean(busy)} value={kind} onChange={event => setKind(event.target.value)}><option value="appointment">Appointment letter</option><option value="offer">Offer letter</option></select></label>
        {context && <Button size="sm" variant="light" isDisabled={Boolean(busy)} onPress={() => { if (window.confirm('Reload employee and company details into this letter? Unsaved changes will be replaced.')) setFields(context.defaults) }}>Use employee details</Button>}
      </div>
      {loading ? <p role="status" className="text-sm text-default-500">Loading employee, salary and company details…</p> : !context ? <div role="alert" className="text-sm text-danger">{error}<Button className="ml-3" size="sm" onPress={() => setAttempt(value => value + 1)}>Retry</Button></div> : <>
        <p className="text-sm text-default-500">Review the populated details and complete any missing agreed terms. Both actions save the issued PDF in the employee’s documents.</p>
        {!context.logo && <p role="alert" className="text-sm text-warning">Upload a company logo in Settings before issuing a letter.</p>}
        <div className="grid gap-4 md:grid-cols-2">
          {LETTER_FIELDS.map(([key, label, type]) => ['salaryBasis', 'paymentFrequency'].includes(key) ? <label key={key} className="text-sm text-default-600">{label}<select aria-label={label} value={fields[key] || ''} onChange={event => setFields(previous => ({ ...previous, [key]: event.target.value }))} className="mt-1 block w-full rounded-xl border border-default-200 bg-default-100 p-3" disabled={Boolean(busy)}>
            <option value="">Select {label.toLowerCase()}</option>
            {(key === 'salaryBasis' ? ['annual CTC', 'monthly gross'] : ['monthly', 'bi-weekly', 'weekly']).map(option => <option key={option} value={option}>{option}</option>)}
          </select></label> : type === 'textarea' ? <Textarea key={key} label={label} value={String(fields[key] ?? '')} onValueChange={value => setFields(previous => ({ ...previous, [key]: value }))} isRequired minRows={2} maxLength={2500} isDisabled={Boolean(busy)} /> : <Input key={key} label={label} type={type || 'text'} value={String(fields[key] ?? '')} onValueChange={value => setFields(previous => ({ ...previous, [key]: value }))} isRequired maxLength={2500} isDisabled={Boolean(busy)} />)}
          <Textarea label="Compensation breakdown (optional)" value={fields.compensationBreakdown || ''} onValueChange={value => setFields(previous => ({ ...previous, compensationBreakdown: value }))} maxLength={5000} isDisabled={Boolean(busy)} />
          <Textarea label="Additional agreed terms (optional)" value={fields.additionalTerms || ''} onValueChange={value => setFields(previous => ({ ...previous, additionalTerms: value }))} maxLength={5000} isDisabled={Boolean(busy)} />
        </div>
        {invalid ? <p role="status" className="text-sm text-warning">{invalid}</p> : <details className="rounded-xl border border-default-200 p-4">
          <summary className="cursor-pointer text-sm font-semibold">Preview letter</summary>
          <div className="mt-4 max-h-[500px] overflow-y-auto space-y-4 text-sm text-default-700">
            <div className="flex items-center gap-4 border-b border-default-200 pb-4">{logo && <img src={logo} alt={`${fields.companyName} logo`} className="h-14 w-24 object-contain" />}<div><h3 className="text-lg font-bold">{fields.companyName}</h3><p>{fields.companyAddress}</p></div></div>
            <h4 className="text-base font-bold">{kind === 'offer' ? 'Offer of employment' : 'Appointment letter'}</h4>
            <p>{fields.issueDate} · {fields.employeeName} · {fields.employeeCode}<br />{fields.employeeAddress}</p>
            {employmentLetterParagraphs(kind, fields).map((entry, index) => <div key={index}>{entry.title && <h5 className="font-semibold">{entry.title}</h5>}<p className="whitespace-pre-line">{entry.text}</p></div>)}
          </div>
        </details>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {saved && <p role="status" className="text-sm text-success">Letter saved in employee documents.{saved.emailDelivery?.status === 'sent' ? ` Email sent to ${saved.emailDelivery.recipient}.` : ''}</p>}
        <div className="flex flex-wrap gap-3"><Button color="primary" isLoading={busy === 'download'} isDisabled={Boolean(invalid) || !context.logo || Boolean(busy)} onPress={() => issue(false)}>Download PDF</Button><Button variant="flat" isLoading={busy === 'email'} isDisabled={Boolean(invalid) || !context.logo || !context.email || Boolean(busy)} onPress={() => issue(true)}>Save &amp; send email</Button></div>
        <p className="text-xs text-default-500">Email recipient: {context.email || 'Add the employee email address in their profile'}</p>
      </>}
    </>}
  </div>
}
