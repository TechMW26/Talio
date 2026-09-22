'use client'

import { useEffect } from 'react'
import { applyImageFallback } from '@/lib/imageFallback'

/**
 * Provides a final safety net for images rendered anywhere in the application.
 * Component-level onError handlers run first and keep their more specific
 * fallback; this handler only acts when the failed source remains unchanged.
 */
export default function ImageRecovery() {
  useEffect(() => {
    const recoverImage = (event) => {
      const image = event.target
      if (!(image instanceof HTMLImageElement)) return

      const failedSource = image.currentSrc || image.src || ''

      window.setTimeout(() => {
        if (!image.isConnected) return
        applyImageFallback(image, failedSource)
      }, 0)
    }

    document.addEventListener('error', recoverImage, true)
    // Server-rendered/cached images can fail before this effect attaches.
    for (const image of document.images) {
      if (image.complete && image.naturalWidth === 0 && image.getAttribute('src')) {
        recoverImage({ target: image })
      }
    }
    return () => document.removeEventListener('error', recoverImage, true)
  }, [])

  return null
}
