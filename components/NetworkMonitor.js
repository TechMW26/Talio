'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import Loader from '@/components/ui/Loader'

/**
 * NetworkMonitor Component
 * 
 * This component runs on all pages and provides:
 * 1. Saves current URL to localStorage for offline recovery
 * 2. Monitors network connectivity
 * 3. Shows non-blocking status banner when offline
 * 4. Triggers soft refresh event when connection is restored
 * 
 * NOTE: This is DISABLED for desktop apps - they have their own offline handling
 * in the Electron main process with a custom offline.html page.
 */

const STORAGE_KEY = 'talio_last_url'
const POLL_INTERVAL = 3000 // 3 seconds

export default function NetworkMonitor() {
  const pathname = usePathname()
  const [isOffline, setIsOffline] = useState(false)
  const [checkAttempts, setCheckAttempts] = useState(0)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [isDesktopApp, setIsDesktopApp] = useState(false)
  const pollIntervalRef = useRef(null)
  const hasShownOfflineRef = useRef(false)

  // Check if running in desktop app
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Check for Electron/desktop app indicators
      const isElectron = window.isElectron === true || 
                         window.electronAPI !== undefined ||
                         navigator.userAgent.toLowerCase().includes('electron')
      setIsDesktopApp(isElectron)
      
      if (isElectron) {
        console.log('[NetworkMonitor] Desktop app detected - offline handling disabled (using Electron offline page)')
      }
    }
  }, [])

  // Save current URL whenever pathname changes
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    try {
      const fullUrl = window.location.href
      // Don't save offline pages
      if (!fullUrl.includes('/offline') && !fullUrl.startsWith('data:') && !fullUrl.startsWith('file:')) {
        localStorage.setItem(STORAGE_KEY, fullUrl)
      }
    } catch (e) {
      // Ignore storage errors
    }
  }, [pathname])

  // Monitor network status - SKIP for desktop apps
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    // Skip offline handling for desktop apps - they have their own offline page
    if (isDesktopApp) {
      console.log('[NetworkMonitor] Skipping network monitoring for desktop app')
      return
    }

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
          setIsOffline(false)
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null

          // Trigger soft refresh event (non-blocking)
          setTimeout(() => {
            try {
              window.dispatchEvent(new CustomEvent('talio:soft-refresh', { detail: { reason: 'network-poll-restored' } }))
            } catch (e) {}

            setTimeout(() => {
              setIsReconnecting(false)
            }, 2000)
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

        // Trigger non-blocking soft refresh after brief delay
        setTimeout(() => {
          try {
            window.dispatchEvent(new CustomEvent('talio:soft-refresh', { detail: { reason: 'network-online-event' } }))
          } catch (e) {}

          setTimeout(() => {
            setIsReconnecting(false)
          }, 2000)
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
  }, [isDesktopApp])

  // Don't render anything if online OR if in desktop app
  if (!isOffline || isDesktopApp) return null

  // Non-blocking banner UI when offline/reconnecting
  return (
    <div className="fixed top-4 right-4 z-[99999] max-w-sm rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-lg">
      <div className="flex items-start gap-2">
        <Loader size="xs" />
        <div>
          <p className="text-sm font-semibold text-amber-900">
            {isReconnecting ? 'Connection restored' : 'You are offline'}
          </p>
          <p className="text-xs text-amber-800 mt-0.5">
            {isReconnecting
              ? 'Refreshing data in background...'
              : `Auto-checking network every 3s (attempt ${checkAttempts}).`}
          </p>
        </div>
      </div>
    </div>
  )
}
