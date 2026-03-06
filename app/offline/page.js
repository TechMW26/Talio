'use client'

import { useState, useEffect, useRef } from 'react'
import { FaWifi, FaExclamationTriangle, FaHome, FaRedo, FaCloudDownloadAlt, FaServer } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import Loader from '@/components/ui/Loader'

export default function OfflinePage() {
  const [isOnline, setIsOnline] = useState(true)
  const [isChecking, setIsChecking] = useState(false)
  const [lastChecked, setLastChecked] = useState(null)
  const [checkAttempts, setCheckAttempts] = useState(0)
  const [isDesktopApp, setIsDesktopApp] = useState(false)
  const pollIntervalRef = useRef(null)
  const router = useRouter()

  // Check if running in desktop app - if so, use the Electron offline page
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isElectron = window.isElectron === true || 
                         window.electronAPI !== undefined ||
                         navigator.userAgent.toLowerCase().includes('electron')
      setIsDesktopApp(isElectron)
      
      // If desktop app, redirect to the Electron offline handling
      if (isElectron && window.electronAPI && window.electronAPI.loadApp) {
        console.log('[OfflinePage] Desktop app detected - using Electron offline page')
        // Try to reload the main app, which will show the offline.html if needed
        window.electronAPI.loadApp()
        return
      }
    }
  }, [])

  useEffect(() => {
    // Skip for desktop apps
    if (isDesktopApp) return
    
    // Check initial online status
    setIsOnline(navigator.onLine)

    // Start automatic polling every 3 seconds
    const startPolling = () => {
      if (pollIntervalRef.current) return
      
      pollIntervalRef.current = setInterval(async () => {
        setCheckAttempts(prev => prev + 1)
        try {
          const response = await fetch('/api/health', {
            method: 'GET',
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' }
          })
          
          if (response.ok) {
            setIsOnline(true)
            setLastChecked(new Date())
            clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
            
            // Get last URL from localStorage or default to dashboard
            let targetUrl = '/dashboard'
            try {
              const lastUrl = localStorage.getItem('talio_last_url')
              if (lastUrl && !lastUrl.includes('/offline')) {
                // Extract pathname from full URL
                const url = new URL(lastUrl)
                targetUrl = url.pathname + url.search
              }
            } catch (e) {}
            
            // Redirect after brief delay for visual feedback
            setTimeout(() => {
              router.push(targetUrl)
            }, 1500)
          }
        } catch (error) {
          // Still offline
          setLastChecked(new Date())
        }
      }, 3000)
    }

    // Listen for online/offline events
    const handleOnline = () => {
      setIsOnline(true)
      setLastChecked(new Date())
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
      
      // Automatically redirect when back online
      setTimeout(() => {
        let targetUrl = '/dashboard'
        try {
          const lastUrl = localStorage.getItem('talio_last_url')
          if (lastUrl && !lastUrl.includes('/offline')) {
            const url = new URL(lastUrl)
            targetUrl = url.pathname + url.search
          }
        } catch (e) {}
        router.push(targetUrl)
      }, 1500)
    }
    
    const handleOffline = () => {
      setIsOnline(false)
      setLastChecked(new Date())
      startPolling()
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Start polling immediately if offline
    if (!navigator.onLine) {
      startPolling()
    }

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [router, isDesktopApp])

  // Don't render the offline UI for desktop apps
  if (isDesktopApp) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <Loader size="lg" />
      </div>
    )
  }

  const handleRefresh = async () => {
    setIsChecking(true)

    // Try to fetch a small resource to check connectivity
    try {
      const response = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      })

      if (response.ok) {
        setIsOnline(true)
        setLastChecked(new Date())
        setTimeout(() => {
          window.location.reload()
        }, 500)
      } else {
        setIsOnline(false)
        setLastChecked(new Date())
      }
    } catch (error) {
      setIsOnline(false)
      setLastChecked(new Date())
    } finally {
      setTimeout(() => {
        setIsChecking(false)
      }, 1000)
    }
  }

  const handleGoHome = () => {
    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="max-w-lg w-full">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <img
            src="/logo.png"
            alt="Talio Logo"
            className="h-16 w-auto object-contain"
          />
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8 text-center border border-gray-100">
          {/* Animated Icon */}
          <div className="mb-6">
            {isOnline ? (
              <div className="relative">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto animate-pulse">
                  <FaWifi className="w-10 h-10 text-green-600" />
                </div>
                <div className="absolute inset-0 w-20 h-20 mx-auto">
                  <div className="w-full h-full rounded-full border-4 border-green-200 animate-ping"></div>
                </div>
              </div>
            ) : (
              <div className="relative">
                <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                  <FaExclamationTriangle className="w-10 h-10 text-red-600 animate-bounce" />
                </div>
              </div>
            )}
          </div>

          {/* Title and Message */}
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            {isOnline ? '🎉 Connection Restored!' : '📡 You&apos;re Offline'}
          </h1>

          <p className="text-gray-600 mb-6 text-lg">
            {isOnline
              ? 'Your internet connection has been restored. Redirecting to dashboard...'
              : 'It looks like you&apos;re not connected to the internet or the server is down.'
            }
          </p>

          {/* Status Indicator */}
          <div className={`inline-flex items-center space-x-2 px-4 py-2 rounded-full text-sm font-semibold mb-4 ${
            isOnline
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}>
            <div className={`w-3 h-3 rounded-full ${
              isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500 animate-pulse'
            }`} />
            <span>{isOnline ? 'Connected' : 'Disconnected'}</span>
            {lastChecked && (
              <span className="text-xs opacity-75">
                • {lastChecked.toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Auto-retry status (only when offline) */}
          {!isOnline && (
            <div className="mb-8 bg-gray-50 rounded-lg px-4 py-3 border border-gray-200">
              <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
                <Loader size="xs" />
                <span>Auto-checking every 3 seconds... (attempt {checkAttempts})</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                App will automatically reload when connection is restored
              </p>
            </div>
          )}

          {/* Possible Reasons */}
          {!isOnline && (
            <div className="bg-orange-50 dark:bg-orange-950/30 rounded-xl p-5 mb-6 text-left border border-orange-200 dark:border-orange-800">
              <div className="flex items-start space-x-3 mb-3">
                <FaServer className="w-5 h-5 text-orange-600 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-orange-900 mb-2">Possible Reasons:</h3>
                  <ul className="text-sm text-orange-800 space-y-2">
                    <li className="flex items-start">
                      <span className="mr-2">•</span>
                      <span>No internet connection on your device</span>
                    </li>
                    <li className="flex items-start">
                      <span className="mr-2">•</span>
                      <span>Server is temporarily down for maintenance</span>
                    </li>
                    <li className="flex items-start">
                      <span className="mr-2">•</span>
                      <span>Network connectivity issues</span>
                    </li>
                    <li className="flex items-start">
                      <span className="mr-2">•</span>
                      <span>Firewall or proxy blocking the connection</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Available Features */}
          {!isOnline && (
            <div className="bg-blue-50 dark:bg-blue-950/30 rounded-xl p-5 mb-6 text-left border border-blue-200 dark:border-blue-800">
              <div className="flex items-start space-x-3">
                <FaCloudDownloadAlt className="w-5 h-5 text-blue-600 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-blue-900 mb-2">✨ Available Offline:</h3>
                  <ul className="text-sm text-blue-800 space-y-2">
                    <li className="flex items-start">
                      <span className="mr-2">✓</span>
                      <span>View cached dashboard data</span>
                    </li>
                    <li className="flex items-start">
                      <span className="mr-2">✓</span>
                      <span>Access employee information</span>
                    </li>
                    <li className="flex items-start">
                      <span className="mr-2">✓</span>
                      <span>View recent attendance records</span>
                    </li>
                    <li className="flex items-start">
                      <span className="mr-2">✓</span>
                      <span>Browse leave history</span>
                    </li>
                    <li className="flex items-start">
                      <span className="mr-2">✓</span>
                      <span>Check cached reports</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-3">
            {isOnline ? (
              <>
                <div className="flex items-center justify-center space-x-3 text-green-600 py-2">
                  <Loader size="xs" />
                  <span className="text-base font-medium">Redirecting to dashboard...</span>
                </div>
                
                {/* Fallback Button */}
                <button
                  onClick={handleGoHome}
                  className="w-full bg-gradient-to-r from-green-600 to-green-700 text-white py-3.5 px-6 rounded-xl hover:from-green-700 hover:to-green-800 transition-all shadow-lg hover:shadow-xl flex items-center justify-center space-x-2 font-semibold"
                >
                  <FaHome className="w-4 h-4" />
                  <span>Continue to Dashboard</span>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleRefresh}
                  disabled={isChecking}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3.5 px-6 rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg hover:shadow-xl flex items-center justify-center space-x-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isChecking ? (
                    <>
                      <Loader size="xs" />
                      <span>Checking Connection...</span>
                    </>
                  ) : (
                    <>
                      <FaRedo className="w-4 h-4" />
                      <span>Check Connection</span>
                    </>
                  )}
                </button>

                <button
                  onClick={handleGoHome}
                  className="w-full bg-gray-100 text-gray-800 py-3.5 px-6 rounded-xl hover:bg-gray-200 transition-all flex items-center justify-center space-x-2 font-semibold border border-gray-300"
                >
                  <FaHome className="w-4 h-4" />
                  <span>Go to Dashboard (Offline Mode)</span>
                </button>
              </>
            )}
          </div>

          {/* Tips */}
          {!isOnline && (
            <div className="mt-8 pt-6 border-t border-gray-200">
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-gray-800 mb-2 text-sm">💡 Quick Tips:</h4>
                <div className="text-xs text-gray-600 space-y-1.5">
                  <p>• Check your WiFi or mobile data connection</p>
                  <p>• Try turning airplane mode off and on</p>
                  <p>• Contact your IT administrator if the issue persists</p>
                  <p>• This app works offline with limited cached data</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
