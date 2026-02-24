'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export default function ModalPortal({ children, show }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  useEffect(() => {
    if (show) {
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [show])

  if (!show || !mounted) return null

  return createPortal(
    <div style={{ position: 'relative', zIndex: 99999 }}>
      {children}
    </div>,
    document.body
  )
}

