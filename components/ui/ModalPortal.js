'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * ModalPortal - A wrapper component that renders children in a portal
 * This ensures modals appear above header/sidebar regardless of DOM hierarchy
 * 
 * Usage:
 * <ModalPortal isOpen={showModal}>
 *   <div className="modal-overlay" onClick={handleBackdropClick}>
 *     <div className="modal-backdrop" />
 *     <div className="modal-container modal-lg">
 *       ... modal content ...
 *     </div>
 *   </div>
 * </ModalPortal>
 */
export default function ModalPortal({ isOpen, children }) {
  const portalRef = useRef(null)

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  // SSR check
  if (typeof window === 'undefined') return null

  return createPortal(
    <div style={{ position: 'relative', zIndex: 99999 }}>
      {children}
    </div>,
    document.body
  )
}
