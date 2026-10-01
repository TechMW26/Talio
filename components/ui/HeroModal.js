'use client'

import { cloneElement, isValidElement, useState } from 'react'
import { Modal as HeroModal } from '@heroui/react'

/** Native capture handlers keep HeroUI close controls reliable for mouse and keyboard. */
export default function Modal({ isOpen, defaultOpen = false, onOpenChange, onClose, closeButton, ...props }) {
  const [localOpen, setLocalOpen] = useState(defaultOpen)
  const change = open => {
    setLocalOpen(open)
    onOpenChange?.(open)
    if (!open) onClose?.()
  }
  const close = event => {
    event.preventDefault()
    event.stopPropagation()
    change(false)
  }
  const control = isValidElement(closeButton) ? closeButton : <button type="button"><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
  return <HeroModal {...props} isOpen={isOpen ?? localOpen} onOpenChange={change} closeButton={cloneElement(control, {
    onClickCapture: close,
    onKeyDownCapture: event => {
      if (event.key === 'Enter' || event.key === ' ') close(event)
    },
  })} />
}
