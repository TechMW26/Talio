'use client'

import { useEffect } from 'react'
import { useAIAssistant } from '@/contexts/AIAssistantContext'
import toast from '@/utils/toast'

let _interceptError = null

// Expose the interceptor for the toast patch
export function getInterceptor() {
  return _interceptError
}

export function getActivePopupContext(root = typeof document !== 'undefined' ? document : null) {
  if (!root?.querySelectorAll) return null

  const candidates = Array.from(root.querySelectorAll('[role="dialog"], [aria-modal="true"], .modal-container'))
  const popup = candidates.reverse().find((element) => {
    if (element.getAttribute('aria-hidden') === 'true') return false
    const view = root.defaultView || (typeof window !== 'undefined' ? window : null)
    const style = view?.getComputedStyle?.(element)
    return style?.display !== 'none' && style?.visibility !== 'hidden'
  })

  if (!popup) return null

  const heading = popup.querySelector('[data-slot="header"], [id="modal-title"], h1, h2, h3')
  const popupTitle = heading?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Open popup'

  return { surface: 'popup', popupTitle }
}

/**
 * Bridge component that connects toast.error() messages to the AI assistant.
 * Renders nothing - just patches the toast system on mount.
 */
export default function AIAssistantBridge() {
  const { interceptError } = useAIAssistant()

  useEffect(() => {
    _interceptError = interceptError

    // Patch toast.error to also feed errors to the AI assistant
    const originalError = toast.error.__original || toast.error

    const patchedError = (message, options) => {
      // Feed the error message to the AI assistant
      if (typeof message === 'string' && _interceptError) {
        const popupContext = getActivePopupContext()
        _interceptError(message, {
          action: popupContext ? 'popup_error' : 'toast_error',
          ...popupContext,
        })
      }
      return originalError(message, options)
    }

    // Keep reference to original so we don't double-patch
    patchedError.__original = originalError
    toast.error = patchedError

    return () => {
      // Restore original on unmount
      toast.error = originalError
      _interceptError = null
    }
  }, [interceptError])

  return null
}
