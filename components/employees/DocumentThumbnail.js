'use client'

import { useEffect, useRef, useState } from 'react'
import { FaFileAlt } from 'react-icons/fa'
import { fetchDocumentFile } from '@/lib/client/documentFile'

export default function DocumentThumbnail({ file, compact = false }) {
  const host = useRef(null)
  const [visible, setVisible] = useState(false)
  const [image, setImage] = useState(null)
  const [failed, setFailed] = useState(false)
  const url = file.fileUrl || file.url
  const type = file.fileType || file.type || ''
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '120px' })
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible || !url) return
    const controller = new AbortController()
    let objectUrl, pdfTask
    setImage(null); setFailed(false)
    const load = async () => {
      const blob = await fetchDocumentFile(url, { signal: controller.signal })
      if (controller.signal.aborted) return
      if (/^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(blob.type)) {
        objectUrl = URL.createObjectURL(blob)
        setImage(objectUrl)
      } else if (blob.type === 'application/pdf' || /pdf/i.test(type)) {
        const pdfjs = await import('pdfjs-dist/build/pdf.mjs')
        const data = await blob.arrayBuffer()
        if (controller.signal.aborted) return
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
        pdfTask = pdfjs.getDocument({ data, isEvalSupported: false, maxImageSize: 16_777_216 })
        const pdf = await pdfTask.promise
        const page = await pdf.getPage(1)
        if (controller.signal.aborted) return
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: 240 / Math.max(base.width, base.height) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
        if (!controller.signal.aborted) setImage(canvas.toDataURL('image/png'))
        await pdfTask.destroy(); pdfTask = null
      } else setFailed(true)
    }
    load().catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); if (pdfTask) void pdfTask.destroy().catch(() => {}) }
  }, [visible, url, type])
  return <span ref={host} className={`flex w-full max-w-full flex-col overflow-hidden text-slate-700 ${compact ? '' : 'bg-white'}`} style={compact ? { backgroundColor: '#7d8083', color: '#111827', minHeight: !image ? 'calc(var(--folder-height, 300px) * 0.8)' : undefined } : undefined}>
    {image ? <img src={image} alt="" className={compact ? 'block h-auto w-full max-w-full max-h-[180px] object-contain' : 'block h-auto w-full object-contain'} onError={() => { setImage(null); setFailed(true) }} /> : <span className="flex min-h-24 flex-1 flex-col items-center justify-center gap-2 p-4"><FaFileAlt className="text-2xl text-slate-400" /><span className="text-[9px] uppercase tracking-wider">{failed ? 'Open to view' : type.includes('pdf') ? 'PDF' : 'Document'}</span></span>}
    <span className="block w-0 min-w-full truncate border-t border-slate-100 px-2 py-1 text-[9px]">{file.fileName || file.name || 'Document'}</span>
  </span>
}
