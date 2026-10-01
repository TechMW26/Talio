'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { MeetingReactionIcon } from './MeetingVisualIcons'

export default function MeetingReactionOverlay({ anchorRef, reaction, compact }) {
  const [position, setPosition] = useState(null)
  const size = compact ? 48 : 80
  useEffect(() => {
    const anchor = anchorRef.current
    if (!anchor || !reaction) return
    let frame
    const update = () => {
      // The same live tile can move between the app and external PiP documents.
      const doc = anchor.ownerDocument
      const win = doc.defaultView
      const rect = anchor.getBoundingClientRect()
      const next = {
        doc,
        left: Math.max(8, Math.min(win.innerWidth - size - 8, rect.left + rect.width / 2 - size / 2)),
        top: Math.max(8, rect.top - size * 0.75),
      }
      setPosition(previous => previous?.doc === next.doc && previous.left === next.left && previous.top === next.top ? previous : next)
      frame = requestAnimationFrame(update)
    }
    update()
    return () => cancelAnimationFrame(frame)
  }, [anchorRef, reaction, size])
  if (!reaction || !position) return null
  return createPortal(<span data-meeting-reaction-overlay className="pointer-events-none fixed drop-shadow-lg" style={{ top: position.top, left: position.left, width: size, height: size, zIndex: 2147483647 }}>
    <MeetingReactionIcon value={reaction} className="h-full w-full" />
  </span>, position.doc.body)
}
