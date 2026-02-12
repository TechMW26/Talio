'use client'
import { useState, useEffect } from 'react'
import { Button } from '@heroui/react'
import { FaDownload, FaDesktop, FaApple, FaWindows } from 'react-icons/fa'
import { getCurrentUser } from '@/utils/userHelper'

/**
 * Check if the user is accessing via a native app (desktop)
 * Returns true if user is in Electron desktop app
 */
export function isNativeApp() {
  if (typeof window === 'undefined') return false

  // Desktop app (Electron) detection
  if (window.talioDesktop) return true
  if (window.electronAPI) return true
  if (window.isElectron === true) return true
  if (navigator.userAgent.toLowerCase().includes('electron')) return true

  // PWA detection (standalone mode)
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  if (window.navigator.standalone === true) return true

  return false
}

/**
 * Check if user should be restricted from web access
 * Only admins can access via web browser
 */
export function shouldRestrictWebAccess() {
  if (typeof window === 'undefined') return false

  // Allow access if using native app
  if (isNativeApp()) return false

  // Check user role
  const user = getCurrentUser()
  if (!user) return false

  // Only admin can access via web
  return user.role !== 'admin'
}

/**
 * Web Access Restriction Component
 * Shows download prompt for non-admin users trying to access via web browser
 */
export default function WebAccessRestriction() {
  const [userName, setUserName] = useState('')

  useEffect(() => {
    const user = getCurrentUser()
    if (user) {
      setUserName(user.firstName || user.email?.split('@')[0] || 'User')
    }
  }, [])

  const handleDownload = () => {
    window.open('https://talio.in/downloads/index.html', '_blank')
  }

  const handleLogout = () => {
    // Fire-and-forget: trigger server-side logout (enqueues productivity analysis)
    const token = localStorage.getItem('token')
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      }).catch(() => { })
    }
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    localStorage.removeItem('userId')
    document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    window.location.href = '/login'
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-md w-full">
        {/* Main Card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          {/* Header */}
          <div className="bg-primary p-6 text-center">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <FaDesktop className="text-white text-2xl" />
            </div>
            <h1 className="text-2xl font-bold text-white">Download Talio App</h1>
            <p className="text-white/80 mt-2 text-sm">
              Hey {userName}! Please use our app for the best experience.
            </p>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-100 dark:border-blue-800">
              <p className="text-gray-700 dark:text-gray-300 text-sm text-center">
                For security and productivity tracking, the dashboard is only accessible through our official apps. Please download the app for your device.
              </p>
            </div>

            {/* Download Button */}
            <Button
              color="primary"
              size="lg"
              className="w-full font-semibold"
              startContent={<FaDownload />}
              onPress={handleDownload}
            >
              Download App
            </Button>

            {/* Platform Icons */}
            <div className="flex justify-center gap-4 py-2">
              <div className="flex flex-col items-center gap-1">
                <div className="w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                  <FaWindows className="text-blue-500 text-lg" />
                </div>
                <span className="text-xs text-gray-500">Windows</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div className="w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                  <FaApple className="text-gray-800 dark:text-gray-200 text-lg" />
                </div>
                <span className="text-xs text-gray-500">macOS</span>
              </div>
            </div>

            {/* Features */}
            <div className="border-t dark:border-gray-700 pt-4 mt-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 text-center mb-3">
                Why use the app?
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                  Faster performance
                </div>
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                  Offline support
                </div>
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                  Push notifications
                </div>
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                  Auto check-in
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 pb-6">
            <button
              onClick={handleLogout}
              className="w-full text-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 transition-colors"
            >
              Logout and use a different account
            </button>
          </div>
        </div>

        {/* Help text */}
        <p className="text-center text-xs text-gray-500 dark:text-gray-400 mt-4">
          Having trouble? Contact your administrator or IT support.
        </p>
      </div>
    </div>
  )
}
