'use client'

import { useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import { MIRA_ATTACHMENT_ACCEPT, miraFileError } from '@/lib/miraAttachments'

export default function MiraAttachments({ files, onChange, busy, onBusyChange }) {
  const input = useRef(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const upload = async event => {
    const selected = [...event.target.files]
    event.target.value = ''
    if (!selected.length) return
    if (selected.length + files.length > 3) { setError('Attach up to three files per message.'); return }
    const invalid = selected.map(miraFileError).find(Boolean)
    if (invalid) { setError(invalid); return }
    setError(''); setReading(true); onBusyChange(true)
    const next = [...files]
    try {
      for (const file of selected) {
        const form = new FormData()
        form.append('file', file)
        const token = localStorage.getItem('token') || document.cookie.match(/token=([^;]+)/)?.[1] || ''
        const response = await fetch('/api/ai/mira-attachments', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
        const result = await response.json()
        if (!response.ok || !result.success) throw new Error(result.message || 'File could not be read.')
        next.push(result.attachment)
        onChange([...next])
      }
    } catch (error) { setError(error.message || 'Upload failed. Please try again.') }
    finally { setReading(false); onBusyChange(false) }
  }
  return <div className="mb-2 text-xs text-default-600">
    <input ref={input} type="file" multiple accept={MIRA_ATTACHMENT_ACCEPT} onChange={upload} className="hidden" aria-label="Choose files for MIRA" disabled={busy || reading} />
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => input.current?.click()} disabled={busy || reading || files.length >= 3} className="inline-flex items-center gap-1.5 rounded-full bg-default-100 px-3 py-2 disabled:opacity-50" aria-label="Attach files to MIRA"><Paperclip size={16} />{reading ? 'Reading file…' : 'Attach files'}</button>
      {files.map((file, index) => <span key={`${index}-${file.name}`} className="inline-flex max-w-full items-center gap-2 rounded-full border border-default-200 px-3 py-1.5">
        <span className="truncate">{file.name}{file.truncated ? ' (excerpt)' : ''}</span>
        <button type="button" disabled={busy || reading} onClick={() => onChange(files.filter((_, i) => i !== index))} aria-label={`Remove ${file.name}`}><X size={14} /></button>
      </span>)}
    </div>
    <p className="mt-1 text-[10px] text-default-400">Images, TXT, MD, CSV, JSON · 3 files · 2 MB each. Image content is processed by MIRA’s vision provider.</p>
    {reading && <p role="status">Reading attachments…</p>}
    {error && <p role="alert" className="mt-1 text-danger">{error}</p>}
  </div>
}
