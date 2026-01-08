'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

/**
 * NetworkMonitor Component
 * 
 * This component runs on all pages and provides:
 * 1. Saves current URL to localStorage for offline recovery
 * 2. Monitors network connectivity
 * 3. Shows inline reconnection UI when offline
 * 4. Auto-reloads when connection is restored
 * 
 * CRITICAL: This works WITHOUT rebuilding the desktop app!
 * Once the app loads successfully, this component takes over network monitoring.
 */

const STORAGE_KEY = 'talio_last_url'
const POLL_INTERVAL = 3000 // 3 seconds

export default function NetworkMonitor() {
  const pathname = usePathname()
  const [isOffline, setIsOffline] = useState(false)
  const [checkAttempts, setCheckAttempts] = useState(0)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const pollIntervalRef = useRef(null)
  const hasShownOfflineRef = useRef(false)

  // Save current URL whenever pathname changes
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    try {
      const fullUrl = window.location.href
      // Don't save offline pages
      if (!fullUrl.includes('/offline') && !fullUrl.startsWith('data:')) {
        localStorage.setItem(STORAGE_KEY, fullUrl)
      }
    } catch (e) {
      // Ignore storage errors
    }
  }, [pathname])

  // Monitor network status
  useEffect(() => {
    if (typeof window === 'undefined') return

    const checkConnection = async () => {
      try {
        const response = await fetch('/api/health', {
          method: 'GET',
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        })
        return response.ok
      } catch {
        return false
      }
    }

    const startPolling = () => {
      if (pollIntervalRef.current) return

      pollIntervalRef.current = setInterval(async () => {
        setCheckAttempts(prev => prev + 1)
        const isOnline = await checkConnection()

        if (isOnline) {
          // Connection restored!
          setIsReconnecting(true)
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null

          // Get last URL and redirect
          setTimeout(() => {
            let targetUrl = '/dashboard'
            try {
              const lastUrl = localStorage.getItem(STORAGE_KEY)
              if (lastUrl && !lastUrl.includes('/offline')) {
                const url = new URL(lastUrl)
                targetUrl = url.pathname + url.search
              }
            } catch (e) {}

            window.location.href = targetUrl
          }, 1500)
        }
      }, POLL_INTERVAL)
    }

    const handleOffline = () => {
      setIsOffline(true)
      setCheckAttempts(0)
      hasShownOfflineRef.current = true
      startPolling()
    }

    const handleOnline = async () => {
      // Verify we're actually online
      const isReallyOnline = await checkConnection()
      if (isReallyOnline) {
        setIsOffline(false)
        setIsReconnecting(true)
        
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
        }

        // Reload the page after brief delay
        setTimeout(() => {
          window.location.reload()
        }, 1000)
      }
    }

    // Listen for browser online/offline events
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

    // Check initial state
    if (!navigator.onLine) {
      handleOffline()
    }

    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  // Don't render anything if online
  if (!isOffline) return null

  // Overlay UI when offline
  return (
    <div 
      className="fixed inset-0 z-[99999] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4"
      style={{ backdropFilter: 'blur(8px)' }}
    >
      <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl p-8 text-center">
        {/* Icon */}
        <div className="mb-6">
          {isReconnecting ? (
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          ) : (
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-10 h-10 text-red-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m-3.536-3.536a4 4 0 010-5.656m-7.072 7.072a9 9 0 010-12.728m3.536 3.536a4 4 0 010 5.656M12 12h.01" />
              </svg>
            </div>
          )}
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {isReconnecting ? '🎉 Connection Restored!' : '📡 Connection Lost'}
        </h2>

        {/* Message */}
        <p className="text-gray-600 mb-6">
          {isReconnecting 
            ? 'Reconnecting to Talio...' 
            : 'Please check your internet connection. We\'ll automatically reconnect when you\'re back online.'}
        </p>

        {/* Status */}
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium mb-6 ${
          isReconnecting ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
        }`}>
          {isReconnecting ? (
            <>
              <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
              <span>Reconnecting...</span>
            </>
          ) : (
            <>
              <div className="w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
              <span>Checking connection... (attempt {checkAttempts})</span>
            </>
          )}
        </div>

        {/* Info */}
        {!isReconnecting && (
          <p className="text-xs text-gray-500">
            Auto-checking every 3 seconds. App will reload when connection is restored.
          </p>
        )}

        {/* Manual retry button */}
        {!isReconnecting && (
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium"
          >
            Try Now
          </button>
        )}
      </div>
    </div>
  )
}
