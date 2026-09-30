'use client'

import { useEffect, useRef, useState } from 'react'
import { getMeetingGrid } from '@/lib/meetingGrid'

export default function ParticipantGrid({ count, children }) {
  const ref = useRef(null)
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
  const { columns, tileWidth } = getMeetingGrid(size.width, size.height, count)
  return <div ref={ref} className="min-h-0 min-w-0 flex-1 overflow-y-auto" data-meeting-layout="grid">
    <div className="flex min-h-full flex-wrap content-center justify-center gap-3" style={{ '--meeting-tile-width': tileWidth ? `${tileWidth}px` : '100%' }} data-grid-columns={columns}>
      {children}
    </div>
  </div>
}
