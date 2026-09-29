'use client'
import { useEffect, useRef, useState } from 'react'

/** Lazy browser-only renderers: no external Office service or public file URL. */
export default function PresentationReader({ buffer, format, page, expectedCount, onReady, onRendered, onError }) {
  const host = useRef(null), callbacks = useRef({ onReady, onRendered, onError })
  callbacks.current = { onReady, onRendered, onError }
  const [resource, setResource] = useState(null)
  const [width, setWidth] = useState(800)
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, Math.floor(entries[0].contentRect.width))))
    if (host.current) observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let stopped = false, cleanup = () => {}
    setResource(null)
    const load = async () => {
      if (format === 'pdf') {
        const pdfjs = await import('pdfjs-dist/build/pdf.mjs')
        if (stopped) return
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
        const task = pdfjs.getDocument({ data: buffer.slice(0), isEvalSupported: false, maxImageSize: 16_777_216 })
        cleanup = () => { task.destroy().catch(() => {}) }
        const document = await task.promise
        if (stopped) { cleanup(); return }
        if (document.numPages < 1 || document.numPages > 100) throw new Error('Use a presentation with 1–100 pages')
        if (expectedCount && document.numPages !== expectedCount) throw new Error('The page count changed. Ask HR to publish this file again.')
        callbacks.current.onReady?.(document.numPages)
        setResource({ pdf: document })
      } else {
        const { PptxViewer, parseZip, buildPresentation, RECOMMENDED_ZIP_LIMITS } = await import('@aiden0z/pptx-renderer')
        const files = await parseZip(buffer.slice(0), { ...RECOMMENDED_ZIP_LIMITS, maxTotalUncompressedBytes: 100 * 1024 * 1024 })
        if (stopped) return
        const presentation = buildPresentation(files)
        const failures = { current: null }
        const viewer = new PptxViewer(host.current, { fitMode: 'contain', pdfjs: false, onSlideError: (_index, error) => { failures.current = error }, onNodeError: (_id, error) => { failures.current = error } })
        cleanup = () => viewer.destroy()
        viewer.load(presentation)
        if (viewer.slideCount < 1 || viewer.slideCount > 100) throw new Error('Use a presentation with 1–100 slides')
        if (expectedCount && viewer.slideCount !== expectedCount) throw new Error('The slide count changed. Ask HR to publish this file again.')
        callbacks.current.onReady?.(viewer.slideCount)
        setResource({ pptx: viewer, failures })
      }
    }
    load().catch(error => { if (!stopped) callbacks.current.onError?.(new Error(`Unable to display this presentation. ${error.message || 'Export it as PDF and try again.'}`)); cleanup() })
    return () => { stopped = true; cleanup() }
  }, [buffer, format, expectedCount])
  useEffect(() => {
    if (!resource) return
    let stopped = false, task
    const render = async () => {
      if (resource.pdf) {
        const pdfPage = await resource.pdf.getPage(page)
        if (stopped) return
        const base = pdfPage.getViewport({ scale: 1 })
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const viewport = pdfPage.getViewport({ scale: width / base.width * ratio })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
        canvas.style.width = '100%'; canvas.style.height = 'auto'
        canvas.setAttribute('aria-label', `Presentation page ${page}`)
        host.current.replaceChildren(canvas)
        task = pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport })
        await task.promise
      } else {
        resource.failures.current = null
        await resource.pptx.renderSlide(page - 1)
        if (resource.failures.current) throw resource.failures.current
      }
      if (!stopped) callbacks.current.onRendered?.(page)
    }
    render().catch(error => { if (!stopped && error.name !== 'RenderingCancelledException') callbacks.current.onError?.(error) })
    return () => { stopped = true; task?.cancel() }
  }, [resource, page, width])
  return <div className="mx-auto w-full max-w-5xl bg-white text-black pointer-events-none" ref={host} aria-label={`Induction presentation page ${page}`} />
}
