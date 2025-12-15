'use client'

import { useEffect } from 'react'

/**
 * ErrorPageCache Component
 * - Caches the offline page in localStorage as backup
 * - Caches the error fallback page for error scenarios
 * 
 * Note: Service Worker registration removed - using native apps instead of PWA
 */
export default function ErrorPageCache() {
  useEffect(() => {
    // Only run in browser
    if (typeof window === 'undefined') return

    // Cache offline page in localStorage as backup
    const cacheOfflinePage = async () => {
      try {
        const response = await fetch('/offline.html')
        if (response.ok) {
          const html = await response.text()
          localStorage.setItem('talio_offline_page', html)
          localStorage.setItem('talio_offline_page_cached_at', new Date().toISOString())
          console.log('[Talio] Offline page cached in localStorage')
        }
      } catch (error) {
        console.error('[Talio] Failed to cache offline page:', error)
      }
    }

    // Cache error fallback page
    const cacheErrorPage = async () => {
      try {
        const response = await fetch('/error-fallback.html')
        if (response.ok) {
          const html = await response.text()
          localStorage.setItem('talio_error_page', html)
          localStorage.setItem('talio_error_page_cached_at', new Date().toISOString())
          console.log('[Talio] Error fallback page cached successfully')
        }
      } catch (error) {
        console.error('[Talio] Failed to cache error page:', error)
      }
    }

    // Check if we need to cache pages (cache for 7 days)
    const offlineCachedAt = localStorage.getItem('talio_offline_page_cached_at')
    const errorCachedAt = localStorage.getItem('talio_error_page_cached_at')
    const sevenDays = 7 * 24 * 60 * 60 * 1000

    const shouldCacheOffline = !offlineCachedAt || 
      (new Date() - new Date(offlineCachedAt)) > sevenDays

    const shouldCacheError = !errorCachedAt || 
      (new Date() - new Date(errorCachedAt)) > sevenDays

    if (shouldCacheOffline) {
      cacheOfflinePage()
    }
    
    if (shouldCacheError) {
      cacheErrorPage()
    }

    // Unregister any existing service workers (cleanup from previous PWA)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => {
          registration.unregister()
          console.log('[Talio] Unregistered old service worker')
        })
      })
    }
  }, [])

  // This component doesn't render anything
  return null
}

