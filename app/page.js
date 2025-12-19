'use client'

import { useEffect, useState } from 'react'

export default function Home() {
  const [showClearOption, setShowClearOption] = useState(false)

  useEffect(() => {
    // Check if initial setup is needed first
    const checkSetupAndSession = async () => {
      try {
        console.log('[Session Check] Starting...')
        
        // First, check if setup is needed (no admin users)
        const setupResponse = await fetch('/api/setup/check')
        const setupData = await setupResponse.json()
        
        if (setupData.success && setupData.needsSetup) {
          console.log('[Session Check] Initial setup needed, redirecting to setup...')
          window.location.replace('/setup')
          return
        }

        // If setup is complete, check for existing session
        const token = localStorage.getItem('token')
        const user = localStorage.getItem('user')

        console.log('[Session Check] Token exists:', !!token)
        console.log('[Session Check] User exists:', !!user)

        if (token && user) {
          // User is logged in, redirect to dashboard
          console.log('[Session Check] Redirecting to dashboard...')
          window.location.replace('/dashboard')
        } else {
          // No session, redirect to login page
          console.log('[Session Check] Redirecting to login...')
          window.location.replace('/login')
        }
      } catch (error) {
        console.error('[Session Check] Error:', error)
        // On error, try to redirect to login
        // If setup check failed, login page will handle it
        try {
          localStorage.clear()
          sessionStorage.clear()
        } catch (e) {
          console.error('[Session Check] Failed to clear storage:', e)
        }
        window.location.replace('/login')
      }
    }

    checkSetupAndSession()

    // Set a timeout to show clear cache option if stuck
    const stuckTimer = setTimeout(() => {
      setShowClearOption(true)
    }, 3000) // Show option after 3 seconds (increased for setup check)

    return () => clearTimeout(stuckTimer)
  }, [])

  const clearCacheAndRedirect = () => {
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
    <div className="min-h-screen flex items-center justify-center bg-white" style={{ backgroundColor: '#FFFFFF', minHeight: '100vh' }}>
      <style jsx global>{`
        html, body {
          background-color: #FFFFFF !important;
        }
      `}</style>
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Checking session...</p>

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

