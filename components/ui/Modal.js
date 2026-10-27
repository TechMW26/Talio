'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { FaTimes } from 'react-icons/fa'

export default function Modal({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  size = 'md', // sm, md, lg, xl, 2xl, 3xl, 4xl, 5xl, full
  showCloseButton = true,
  className = ''
}) {
  const modalRef = useRef(null)

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose?.()
      }
    }
    
    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }
    
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  // Handle click outside
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose?.()
    }
  }

  if (!isOpen) return null

  // Map size prop to modal-* class
  const sizeClass = `modal-${size}`

  const modalContent = (
    <div 
      className="modal-overlay"
      onClick={handleBackdropClick}
    >
      {/* Backdrop is supplied by the overlay; retained for legacy styling. */}
      <div className="modal-backdrop" />
      
      {/* Modal */}
      <div 
        ref={modalRef}
        className={`modal-container ${sizeClass} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="modal-header">
            {title && (
              <h3 id="modal-title" className="modal-title">
                {title}
              </h3>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="modal-close-btn"
                aria-label="Close modal"
              >
                <FaTimes className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
        
        {/* Content */}
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>
  )

  // Use portal to render outside parent div
  if (typeof window !== 'undefined') {
    return createPortal(modalContent, document.body)
  }

  return null
}

// Pre-styled modal sections for consistency
export function ModalBody({ children, className = '' }) {
  return (
    <div className={`modal-body ${className}`}>
      {children}
    </div>
  )
}

export function ModalFooter({ children, className = '' }) {
  return (
    <div className={`modal-footer ${className}`}>
      {children}
    </div>
  )
}

// Two column layout for desktop
export function ModalTwoColumn({ left, right, className = '' }) {
  return (
    <div className={`grid grid-cols-1 lg:grid-cols-2 gap-6 ${className}`}>
      <div>{left}</div>
      <div>{right}</div>
    </div>
  )
}
