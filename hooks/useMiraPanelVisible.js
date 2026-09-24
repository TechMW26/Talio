'use client'

import { useEffect, useState } from 'react'

// A portal can mount while already open. Paint its closed state first so the
// browser has a real transition start; cancel pending frames on close/unmount.
export default function useMiraPanelVisible(open) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!open) { setVisible(false); return }
    let secondFrame
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setVisible(true))
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      if (secondFrame !== undefined) cancelAnimationFrame(secondFrame)
    }
  }, [open])
  return open && visible
}
