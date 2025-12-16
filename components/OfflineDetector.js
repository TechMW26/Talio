'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import toast from 'react-hot-toast'

/**
 * OfflineDetector Component
 * Detects when user goes offline and redirects to offline page
 * Automatically reloads the app when connection is restored or network changes
 * Shows toast notifications for online/offline status changes
 */
export default function OfflineDetector() {
  const router = useRouter()
  const pathname = usePathname()
  const [isOnline, setIsOnline] = useState(true)
  const [hasShownOfflineToast, setHasShownOfflineToast] = useState(false)
  const wasOfflineRef = useRef(false)
  const previousNetworkTypeRef = useRef(null)

  useEffect(() => {
    // Don't run on offline page itself
    if (pathname === '/offline') {
      return
    }

    // Check initial online status
    setIsOnline(navigator.onLine)

    const handleOnline = () => {
      console.log('[OfflineDetector] Connection restored')
      setIsOnline(true)
      setHasShownOfflineToast(false)
      
      // Show success toast
      toast.success('Connection restored! Reloading...', {
        duration: 2000,
        icon: '🌐',
        style: {
          background: '#10B981',
          color: '#fff',
        },
      })
      
      // Auto-reload the page when coming back online
      if (wasOfflineRef.current) {
        setTimeout(() => {
          window.location.reload()
        }, 1500)
      }
      wasOfflineRef.current = false
    }

    const handleOffline = () => {
      console.log('[OfflineDetector] Connection lost')
      setIsOnline(false)
      wasOfflineRef.current = true
      
      // Show offline toast only once
      if (!hasShownOfflineToast) {
        toast.error('You are offline. Some features may not be available.', {
          duration: 5000,
          icon: '📡',
          style: {
            background: '#EF4444',
            color: '#fff',
          },
        })
        setHasShownOfflineToast(true)
      }

      // Redirect to offline page after a short delay
      setTimeout(() => {
        if (!navigator.onLine) {
          router.push('/offline')
        }
      }, 2000)
    }
    
    // Handle network type changes (e.g., WiFi to cellular, or network switch)
    const handleNetworkChange = () => {
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
      if (!connection) return
      
      const currentType = connection.effectiveType || connection.type
      const previousType = previousNetworkTypeRef.current
      
      console.log('[OfflineDetector] Network change detected:', previousType, '->', currentType)
      
      // Only reload if we had a previous network type (not initial load)
      // and the network type actually changed
      if (previousType && previousType !== currentType && navigator.onLine) {
        toast.success(`Network changed to ${currentType}. Refreshing...`, {
          duration: 2000,
          icon: '📶',
          style: {
            background: '#3B82F6',
            color: '#fff',
          },
        })
        
        // Reload after a short delay to let the new connection stabilize
        setTimeout(() => {
          window.location.reload()
        }, 1500)
      }
      
      previousNetworkTypeRef.current = currentType
    }

    // Add event listeners
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    // Network Information API for detecting network changes
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
    if (connection) {
      // Store initial network type
      previousNetworkTypeRef.current = connection.effectiveType || connection.type
      connection.addEventListener('change', handleNetworkChange)
    }
    
    // Also listen for visibility change to check connection when tab becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        // Check if we were offline before and now we're online
        if (wasOfflineRef.current) {
          console.log('[OfflineDetector] Tab visible and connection restored')
          handleOnline()
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Periodic connectivity check (every 30 seconds)
    const checkConnectivity = async () => {
      try {
        const response = await fetch('/manifest.json', {
          method: 'HEAD',
          cache: 'no-cache',
        })
        
        if (!response.ok && navigator.onLine) {
          // Server is down but browser thinks we're online
          console.log('[OfflineDetector] Server appears to be down')
          handleOffline()
        }
      } catch (error) {
        // Network error
        if (navigator.onLine) {
          console.log('[OfflineDetector] Network error detected')
          handleOffline()
        }
      }
    }

    const intervalId = setInterval(checkConnectivity, 30000)

    // Cleanup
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (connection) {
        connection.removeEventListener('change', handleNetworkChange)
      }
      clearInterval(intervalId)
    }
  }, [router, pathname, hasShownOfflineToast])

  // This component doesn't render anything
  return null
}

