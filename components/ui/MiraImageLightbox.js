'use client'
import { useEffect, useRef, useState } from 'react'

export function useMiraImage(source) {
  const [state, setState] = useState({ src: '', error: '' })
  useEffect(() => {
    setState({ src: '', error: '' })
    if (!source) return
    if (source.startsWith('blob:')) { setState({ src: source, error: '' }); return }
    if (!/^\/api\/(?:activity\/screenshot\?|productivity\/composite\/image\?)/.test(source)) { setState({ src: '', error: 'Invalid image source.' }); return }
    const controller = new AbortController()
    let url
    const token = localStorage.getItem('token') || document.cookie.match(/token=([^;]+)/)?.[1] || ''
    fetch(source, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store' }).then(async res => {
      if (!res.ok) throw new Error('Image unavailable, expired, or access denied.')
      const blob = await res.blob()
      if (controller.signal.aborted) return
      url = URL.createObjectURL(blob); setState({ src: url, error: '' })
    }).catch(error => { if (!controller.signal.aborted) setState({ src: '', error: error.message }) })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [source])
  return state
}

export default function MiraImageLightbox({ items, index, onChange, onClose }) {
  const ref = useRef(null)
  const item = items[index]
  const { src, error } = useMiraImage(item?.imageUrl)
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close() }, [])
  return <dialog ref={ref} aria-label="Image viewer" onCancel={event => { event.preventDefault(); onClose() }} onClick={event => event.stopPropagation()} onKeyDown={event => {
    if (event.key === 'ArrowLeft' && index > 0) onChange(index - 1)
    if (event.key === 'ArrowRight' && index < items.length - 1) onChange(index + 1)
  }} className="m-auto w-[96vw] max-w-6xl max-h-[96dvh] rounded-xl bg-zinc-950 p-3 text-white backdrop:bg-black/80">
    <header className="mb-3 flex items-center justify-between gap-2"><span className="text-xs">{item?.label || 'Image'} · {index + 1}/{items.length}</span><button autoFocus aria-label="Close image viewer" onClick={onClose} className="rounded-lg px-3 py-2">✕</button></header>
    {error ? <p role="alert">{error}</p> : src ? <img src={src} alt={item?.label || 'Image'} className="max-h-[75dvh] w-full object-contain" /> : <p role="status">Loading image…</p>}
    {items.length > 1 && <footer className="mt-3 flex justify-center gap-4"><button disabled={index === 0} onClick={() => onChange(index - 1)} className="rounded-lg px-3 py-2 disabled:opacity-30">Previous</button><button disabled={index === items.length - 1} onClick={() => onChange(index + 1)} className="rounded-lg px-3 py-2 disabled:opacity-30">Next</button></footer>}
  </dialog>
}
