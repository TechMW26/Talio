'use client'

import { useEffect, useState } from 'react'
import Loader from '@/components/ui/Loader'

/**
 * Check if running in Electron/desktop app environment
 * Multiple detection methods for reliability
 */
function isDesktopApp() {
  if (typeof window === 'undefined') return false

  // Method 1: Check talioDesktop API from preload
  if (window.talioDesktop?.isDesktopApp) return true

  // Method 2: Check user agent for Electron
  if (navigator.userAgent.toLowerCase().includes('electron')) return true

  // Method 3: Check for Electron-specific objects
  if (window.process?.type === 'renderer') return true

  // Method 4: Check if window.require exists (Electron context)
  if (typeof window.require === 'function') return true

  return false
}

export default function Home() {
  const [showClearOption, setShowClearOption] = useState(false)

  useEffect(() => {
    // Use a ref-like approach with a flag to prevent double execution
    let hasStarted = false

    const checkSetupAndSession = async () => {
      // Prevent double execution within same render cycle
      if (hasStarted) return
      hasStarted = true

      try {
        console.log('[Session Check] Starting...')
        console.log('[Session Check] Is Desktop App:', isDesktopApp())

        // First, check for existing session in localStorage
        // This is faster than API call and prevents loops
        const token = localStorage.getItem('token')
        const user = localStorage.getItem('user')

        console.log('[Session Check] Token exists:', !!token)
        console.log('[Session Check] User exists:', !!user)

        if (token && user) {
          // User is logged in, redirect to dashboard
          console.log('[Session Check] Redirecting to dashboard...')
          window.location.href = '/dashboard'
          return
        }

        // For desktop app, skip setup check (handled by superadmin)
        // Just redirect to login directly
        if (isDesktopApp()) {
          console.log('[Session Check] Desktop app - redirecting to login...')
          window.location.href = '/login'
          return
        }

        // For web app, check if setup is needed (with timeout)
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 3000) // 3 second timeout

        try {
          const setupResponse = await fetch('/api/setup/check', { signal: controller.signal })
          clearTimeout(timeoutId)
          const setupData = await setupResponse.json()

          if (setupData.success && setupData.needsSetup) {
            console.log('[Session Check] Initial setup needed, redirecting to setup...')
            window.location.href = '/setup'
            return
          }
        } catch (fetchError) {
          clearTimeout(timeoutId)
          console.log('[Session Check] Setup check failed/timeout, proceeding to login...')
        }

        // No session, redirect to login page
        console.log('[Session Check] Redirecting to login...')
        window.location.href = '/login'

      } catch (error) {
        console.error('[Session Check] Error:', error)
        // On error, redirect to login
        console.log('[Session Check] Error occurred, redirecting to login...')
        window.location.href = '/login'
      }
    }

    checkSetupAndSession()

    // Set a timeout to show clear cache option if stuck (only for web browser)
    const stuckTimer = setTimeout(() => {
      if (!isDesktopApp()) {
        setShowClearOption(true)
      } else {
        // For desktop app, try login redirect if stuck
        console.log('[Session Check] Desktop app stuck, forcing login redirect...')
        window.location.href = '/login'
      }
    }, 5000) // Show option after 5 seconds

    return () => {
      clearTimeout(stuckTimer)
    }
  }, []) // Empty dependency array - run only once

  const clearCacheAndRedirect = () => {
    // CRITICAL: Don't clear storage in desktop app
    if (isDesktopApp()) {
      console.log('[Session Check] Desktop app detected, redirecting without cache clear')
      window.location.replace('/login')
      return
    }

    // Clear all storage
    try {
      localStorage.clear()
      sessionStorage.clear()

      // Clear cookies
      document.cookie.split(";").forEach((c) => {
        document.cookie = c
          .replace(/^ +/, "")
          .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/")
      })
    } catch (e) {
      console.error('Failed to clear cache:', e)
    }

    // Force redirect to login
    window.location.replace('/login')
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-white" style={{ backgroundColor: '#FFFFFF', minHeight: '100vh', width: '100%' }}>
      <style jsx global>{`
        html, body {
          background-color: #FFFFFF !important;
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
        }
      `}</style>
      <div className="text-center flex flex-col items-center justify-center">
        <Loader size="lg" />
        <p className="mt-4 text-gray-600 text-center">Checking session...</p>

        {showClearOption && (
          <div className="mt-6 p-4 bg-white rounded-lg shadow-lg max-w-sm mx-auto">
            <p className="text-sm text-gray-700 mb-3">Taking longer than expected?</p>
            <button
              onClick={clearCacheAndRedirect}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
            >
              Clear Cache & Session
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

