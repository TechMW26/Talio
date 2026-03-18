'use client'

import { useEffect } from 'react'
import { useAIAssistant } from '@/contexts/AIAssistantContext'
import toast from '@/utils/toast'

let _interceptError = null

// Expose the interceptor for the toast patch
export function getInterceptor() {
  return _interceptError
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
        _interceptError(message, { action: 'toast_error' })
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
