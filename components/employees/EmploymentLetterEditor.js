'use client'

import { useState } from 'react'
import { Button } from '@heroui/react'

export default function EmploymentLetterEditor({ name, value, onSave, busy }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState(value?.kind || 'appointment')
  const template = type => `${type === 'offer' ? 'OFFER OF EMPLOYMENT' : 'APPOINTMENT LETTER'}\n\nDate: [Issue date]\nCompany: [Legal company name and address]\n\nDear ${name || '[Employee name]'},\n\nWe are pleased to ${type === 'offer' ? 'offer you employment' : 'confirm your appointment'} as [Designation] in [Department], reporting to [Manager], effective [Joining date] at [Work location].\n\nCompensation: [Approved salary, currency, payment frequency and benefits; attach the compensation schedule].\nWorking arrangements: [Working days, hours and applicable leave policy].\nProbation and review: [Agreed duration and review terms, if applicable].\nNotice and separation: [Approved notice period and applicable terms].\nConfidentiality, conduct and company policies: [Applicable policy references].\nOther agreed terms: [Insert or remove as appropriate].\n\nPlease review and acknowledge the terms of this letter.\n\nAuthorized signatory: __________________\nEmployee acceptance and date: __________________`
  const [content, setContent] = useState(value?.content || template(kind))
  const download = () => {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `${kind}-letter.txt`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className="mt-4 rounded-xl border border-default-200 p-4 space-y-3">
    <Button size="sm" variant="flat" onPress={() => setOpen(!open)}>Prepare offer / appointment letter</Button>
    {open && <>
      <p className="text-xs text-default-500">Editable draft only. Replace every bracketed field and obtain HR approval before issuing. This does not send a letter or change employment status.</p>
      <select aria-label="Letter type" className="rounded-lg border bg-transparent p-2" value={kind} onChange={e => setKind(e.target.value)}><option value="appointment">Appointment letter</option><option value="offer">Offer letter</option></select>
      <Button size="sm" variant="light" onPress={() => { if (window.confirm('Replace the current draft with the baseline template?')) setContent(template(kind)) }}>Reset template</Button>
      <textarea aria-label="Employment letter draft" className="w-full min-h-80 rounded-lg border border-default-200 bg-transparent p-3 text-sm" maxLength={20000} value={content} onChange={e => setContent(e.target.value)} />
      <div className="flex gap-2"><Button color="primary" isLoading={busy} isDisabled={!content.trim()} onPress={() => onSave({ kind, content })}>Save draft</Button><Button variant="flat" onPress={download}>Download text</Button></div>
    </>}
  </div>
}
