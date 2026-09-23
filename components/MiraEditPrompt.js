'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function MiraEditPrompt({ message, onClose, onSave, busy }) {
  const dialog = useRef(null)
  const [value, setValue] = useState(message.content)
  useEffect(() => { dialog.current?.showModal() }, [])
  const resend = () => { if (value.trim() && !busy) onSave(message, value.trim()) }
  return createPortal(<dialog ref={dialog} onCancel={onClose} aria-labelledby="mira-edit-title"
    className="m-auto w-[calc(100%-2rem)] max-w-2xl rounded-3xl border border-white/15 bg-neutral-900/90 p-5 text-neutral-100 shadow-2xl backdrop-blur-2xl backdrop:bg-black/50"
    onKeyDown={event => { event.stopPropagation(); if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); resend() } }}>
    <h3 id="mira-edit-title" className="font-semibold">Edit message</h3>
    <p className="mt-1 text-xs text-neutral-400">Ctrl/Cmd + Enter to resend. Later replies will be replaced.</p>
    <textarea autoFocus aria-label="Edit message text" value={value} onChange={e => setValue(e.target.value)} rows={6} className="mt-4 w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none focus:border-white/40" />
    <div className="mt-4 flex justify-end gap-2">
      <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm hover:bg-white/10">Cancel</button>
      <button disabled={busy || !value.trim()} onClick={resend} className="rounded-xl bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-40">Resend</button>
    </div>
  </dialog>, document.body)
}
