'use client'

import { useState } from 'react'
import { Skeleton } from './AsciiLoading'

export default function MiraAttention({ attention, onOpen }) {
  const [pending, setPending] = useState(''), [error, setError] = useState('')
  const events = attention?.events || []
  if (attention?.error && !events.length) return <div role="alert" className="mx-3 my-2 rounded-xl bg-default-100 p-3 text-xs text-default-500">Mira attention is temporarily unavailable. <button type="button" onClick={attention.refresh} className="ml-2 text-primary-600">Retry</button></div>
  if (attention?.isLoading && !events.length) return <div role="status" aria-label="Checking your attention items" className="mx-3 my-2"><Skeleton className="h-12 w-full rounded-xl" /></div>
  if (!events.length) return null
  async function update(item, action) {
    setPending(item.id); setError('')
    try { await attention.update(item.id, action, action === 'snooze' ? 30 : undefined) }
    catch (error) { setError(error.message || 'Could not update this item.') }
    finally { setPending('') }
  }
  return <section aria-label="Mira attention" className="mx-3 my-2 shrink-0 rounded-2xl border border-default-200 bg-content1/80 p-3">
    <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-xs font-semibold text-default-600">For your attention</h3>{attention.feed?.quietHours && <span className="text-[10px] text-default-400">Quiet hours</span>}</div>
    <div className="max-h-48 space-y-3 overflow-y-auto">
      {events.slice(0, 3).map(item => <article key={item.id} className="rounded-xl bg-default-100/60 p-2.5">
        <p className="text-xs font-semibold text-foreground">{item.title}</p>
        <p className="mt-1 line-clamp-3 text-xs text-default-600">{item.summary}</p>
        {item.context?.actionItems?.length > 0 && <p className="mt-1 line-clamp-2 text-xs text-default-500">Your recorded actions: {item.context.actionItems.join('; ')}</p>}
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <a href={item.link} onClick={onOpen ? event => { event.preventDefault(); onOpen(item) } : undefined} className="font-medium text-primary-600">Open</a>
          <button type="button" disabled={pending === item.id} onClick={() => update(item, 'snooze')} className="text-default-500 disabled:opacity-50">Snooze 30m</button>
          <button type="button" disabled={pending === item.id} onClick={() => update(item, 'dismiss')} aria-label={`Dismiss ${item.title}`} className="text-default-500 disabled:opacity-50">Dismiss</button>
        </div>
      </article>)}
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
  </section>
}
