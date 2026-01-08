'use client'

import { useState, useEffect } from 'react'
import { FaDownload, FaTimes, FaMobile, FaCheck } from 'react-icons/fa'
import Loader from '@/components/ui/Loader'

export default function PWAInstaller() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showInstallPrompt, setShowInstallPrompt] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)

  useEffect(() => {
    let installPromptTimeout

    // Check if app is already installed
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true)
      return
    }

    // Check if user has dismissed the prompt before
    const dismissed = localStorage.getItem('pwa-install-dismissed')
    if (dismissed) {
      return
    }

    // Listen for beforeinstallprompt event
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)

      // Show install prompt after 3 seconds
      installPromptTimeout = setTimeout(() => {
        if (!isInstalled) {
          setShowInstallPrompt(true)
        }
      }, 3000)
    }

    // Listen for app installed event
    const handleAppInstalled = () => {
      console.log('PWA was installed')
      setIsInstalled(true)
      setShowInstallPrompt(false)
      setDeferredPrompt(null)
      localStorage.removeItem('pwa-install-dismissed')
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
      if (installPromptTimeout) clearTimeout(installPromptTimeout)
    }
  }, [isInstalled])

  const handleInstallClick = async () => {
    if (!deferredPrompt) return

    setIsInstalling(true)

    try {
      // Show the install prompt
      deferredPrompt.prompt()

      // Wait for the user to respond to the prompt
      const { outcome } = await deferredPrompt.userChoice

      if (outcome === 'accepted') {
        console.log('User accepted the install prompt')
        setShowInstallPrompt(false)
      } else {
        console.log('User dismissed the install prompt')
        setIsInstalling(false)
      }

      setDeferredPrompt(null)
    } catch (error) {
      console.error('Error during installation:', error)
      setIsInstalling(false)
    }
  }

  const handleDismiss = () => {
    setShowInstallPrompt(false)
    localStorage.setItem('pwa-install-dismissed', 'true')
  }

  // Don't show if already installed or no prompt available
  if (isInstalled || !showInstallPrompt || !deferredPrompt) {
    return null
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-50 animate-slide-up">
      <div className="bg-white rounded-lg shadow-xl border border-gray-200 p-4 backdrop-blur-sm">
        <div className="flex items-start space-x-3">
          <div className="flex-shrink-0">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <FaMobile className="w-5 h-5 text-blue-600" />
            </div>
          </div>
          
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">
              Install Talio App
            </h3>
            <p className="text-xs text-gray-600 mt-1">
              Get the full app experience with offline access and faster loading
            </p>
            
            <div className="flex space-x-2 mt-3">
              <button
                onClick={handleInstallClick}
                disabled={isInstalling}
                className="flex items-center space-x-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isInstalling ? (
                  <>
                    <Loader size="xs" color="#ffffff" />
                    <span>Installing...</span>
                  </>
                ) : (
                  <>
                    <FaDownload className="w-3 h-3" />
                    <span>Install</span>
                  </>
                )}
              </button>
              
              <button
                onClick={handleDismiss}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 transition-colors"
              >
                Not now
              </button>
            </div>
          </div>
          
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <FaTimes className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

// Hook for checking PWA installation status
export function usePWAInstall() {
  const [isInstalled, setIsInstalled] = useState(false)
  const [canInstall, setCanInstall] = useState(false)

  useEffect(() => {
    // Check if app is installed
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true)
    }

    // Check if app can be installed
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault()
      setCanInstall(true)
    }

    const handleAppInstalled = () => {
      setIsInstalled(true)
      setCanInstall(false)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  return { isInstalled, canInstall }
}

// Component for showing PWA status in header
export function PWAStatus() {
  const { isInstalled } = usePWAInstall()

  if (!isInstalled) return null

  return (
    <div className="flex items-center space-x-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
      <FaCheck className="w-3 h-3" />
      <span className="hidden sm:inline">App Mode</span>
    </div>
  )
}

// Offline indicator component
export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    setIsOnline(navigator.onLine)

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (isOnline) return null

  return (
    <div className="bg-red-500 text-white px-4 py-2 text-center text-sm">
      <div className="flex items-center justify-center space-x-2">
        <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
        <span>You&apos;re offline. Some features may not be available.</span>
      </div>
    </div>
  )
}
