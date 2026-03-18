'use client'

import { useEffect, useState } from 'react'
import Loader from '@/components/ui/Loader'

/**
 * Check if running in Electron/desktop app environment
 * Multiple detection methods for reliability
 */
function isDesktopApp() {
  if (typeof window === 'undefined') return false
  if (window.talioDesktop?.isDesktopApp) return true
  if (navigator.userAgent.toLowerCase().includes('electron')) return true
  if (window.process?.type === 'renderer') return true
  if (typeof window.require === 'function') return true
  return false
}

/**
 * Perform fast synchronous redirect - called immediately on mount.
 * Returns true if a redirect was initiated (caller should stop).
 */
function fastRedirect() {
  try {
    const token = localStorage.getItem('token')
    const user = localStorage.getItem('user')

    if (token && user) {
      window.location.replace('/dashboard')
      return true
    }

    // If setup was already completed before, skip the API check entirely
    const setupDone = localStorage.getItem('talio_setup_done')
    if (setupDone === '1' || isDesktopApp()) {
      window.location.replace('/login')
      return true
    }
  } catch {
    // localStorage blocked - fall through to async check
  }
  return false
}

export default function Home() {
  const [showClearOption, setShowClearOption] = useState(false)

  useEffect(() => {
    // 1. Instant redirect for the common cases (token present OR setup already done)
    if (fastRedirect()) return

    // 2. Only first-time visitors reach here - check if setup is needed (fast timeout)
    let cancelled = false
    const controller = new AbortController()

    const checkSetup = async () => {
      try {
        const timeoutId = setTimeout(() => controller.abort(), 1500) // 1.5s max
        const res = await fetch('/api/setup/check', { signal: controller.signal })
        clearTimeout(timeoutId)
        if (cancelled) return
        const data = await res.json()

        if (data.success && data.needsSetup) {
          window.location.replace('/setup')
          return
        }
      } catch {
        // timeout or network error - just proceed to login
      }

      if (cancelled) return
      // Mark setup as done so future visits skip this API call
      try { localStorage.setItem('talio_setup_done', '1') } catch {}
      window.location.replace('/login')
    }

    checkSetup()

    // Fallback: if still stuck after 3s, force redirect to login
    const stuckTimer = setTimeout(() => {
      if (!cancelled) {
        try { localStorage.setItem('talio_setup_done', '1') } catch {}
        window.location.replace('/login')
      }
    }, 3000)

    // Show clear-cache button after 4s (in case redirect itself is slow)
    const clearTimer = setTimeout(() => {
      if (!isDesktopApp()) setShowClearOption(true)
    }, 4000)

    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(stuckTimer)
      clearTimeout(clearTimer)
    }
  }, [])

  const clearCacheAndRedirect = () => {
    if (isDesktopApp()) {
      window.location.replace('/login')
      return
    }
    try {
      localStorage.clear()
      sessionStorage.clear()
      document.cookie.split(';').forEach((c) => {
        document.cookie = c.replace(/^ +/, '').replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/')
      })
    } catch {}
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

