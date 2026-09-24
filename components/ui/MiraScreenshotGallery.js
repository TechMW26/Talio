'use client'
import { useState } from 'react'
import MiraImageLightbox, { useMiraImage } from './MiraImageLightbox'

function Capture({ item, onOpen }) {
  const { src, error } = useMiraImage(item.imageUrl)
  return <button onClick={onOpen} className="w-56 shrink-0 snap-start overflow-hidden rounded-xl border border-default-200 text-left" aria-label={`Open capture ${item.label}`}>
    {src ? <img loading="lazy" src={src} alt={item.label} className="aspect-video w-full object-contain bg-black" /> : <div className="aspect-video p-3 text-xs" role={error ? 'alert' : 'status'}>{error || 'Loading capture…'}</div>}
    <span className="block p-2 text-xs">{item.label}<span className="block text-default-500">{item.source === 'mosaic' ? 'Mosaic section' : 'Screenshot'}{item.application ? ` · ${item.application}` : ''}</span></span>
  </button>
}
export default function MiraScreenshotGallery({ gallery }) {
  const [data, setData] = useState(gallery)
  const [index, setIndex] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const items = (data.items || []).map(item => ({ ...item, label: new Date(item.capturedAt).toLocaleString(undefined, { timeZoneName: 'short' }) }))
  async function more() {
    setBusy(true); setError('')
    try {
      const token = localStorage.getItem('token') || document.cookie.match(/token=([^;]+)/)?.[1] || ''
      const response = await fetch('/api/ai/mira-actions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: { type: 'view_productivity', fields: { ...data.fields, offset: String(data.nextOffset) } } }) })
      const result = await response.json()
      if (!response.ok || !result.success || !result.gallery) throw new Error(result.message || 'Unable to load captures.')
      setData(previous => ({ ...result.gallery, items: [...previous.items, ...result.gallery.items.filter(item => !previous.items.some(old => old.id === item.id))] }))
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }
  return <section aria-label="Employee screenshot gallery" className="my-3 min-w-0" onClick={event => event.stopPropagation()}>
    <div className="flex gap-3 overflow-x-auto snap-x pb-3">{items.map((item, i) => <Capture key={item.id} item={item} onOpen={() => setIndex(i)} />)}</div>
    {!items.length && <p className="text-sm text-default-500">No captures available for this time.</p>}
    {data.hasMore && <button disabled={busy} onClick={more} className="rounded-lg border border-default-200 px-3 py-2 text-xs">{busy ? 'Loading…' : 'Load more captures'}</button>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    {index !== null && <MiraImageLightbox items={items} index={index} onChange={setIndex} onClose={() => setIndex(null)} />}
  </section>
}
