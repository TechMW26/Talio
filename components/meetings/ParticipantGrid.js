'use client'

import { Children, useEffect, useRef, useState } from 'react'
import { getMeetingGrid } from '@/lib/meetingGrid'

export default function ParticipantGrid({ count, children, pip = false }) {
  const ref = useRef(null)
  const touchStart = useRef(null)
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(count / 4))
  const currentPage = Math.min(page, pages - 1)
  useEffect(() => { setPage(previous => Math.min(previous, pages - 1)) }, [pages])
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const layout = getMeetingGrid(size.width, size.height, count)
  const columns = pip ? 2 : layout.columns
  const tileWidth = pip ? Math.max(0, Math.min((size.width - 12) / 2, (size.height - (pages > 1 ? 36 : 0) - 12) / 2 * 16 / 9)) : layout.tileWidth
  if (pip) return <div ref={ref} className="flex min-h-0 min-w-0 flex-1 flex-col" data-meeting-layout="pip-grid"
    onTouchStart={event => { touchStart.current = event.touches[0]?.clientX }}
    onTouchEnd={event => {
      const end = event.changedTouches[0]?.clientX
      if (touchStart.current != null && end != null && Math.abs(end - touchStart.current) > 40) setPage(Math.max(0, Math.min(pages - 1, currentPage + (end < touchStart.current ? 1 : -1))))
      touchStart.current = null
    }}>
    <div className="grid min-h-0 flex-1 content-center justify-center gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0, max-content))', '--meeting-tile-width': `${tileWidth || 1}px` }}>
      {Children.toArray(children).slice(currentPage * 4, currentPage * 4 + 4)}
    </div>
    {pages > 1 && <nav aria-label="Participant pages" className="flex h-9 shrink-0 items-center justify-center gap-4 text-xs">
      <button type="button" className="rounded-lg px-2 py-1 disabled:opacity-40" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} aria-label="Previous participants">←</button>
      <span aria-live="polite">{currentPage + 1} / {pages}</span>
      <button type="button" className="rounded-lg px-2 py-1 disabled:opacity-40" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)} aria-label="Next participants">→</button>
    </nav>}
  </div>
  return <div ref={ref} className="min-h-0 min-w-0 flex-1 overflow-y-auto" data-meeting-layout="grid">
    <div className="flex min-h-full flex-wrap content-center justify-center gap-3" style={{ '--meeting-tile-width': tileWidth ? `${tileWidth}px` : '100%' }} data-grid-columns={columns}>
      {children}
    </div>
  </div>
}
