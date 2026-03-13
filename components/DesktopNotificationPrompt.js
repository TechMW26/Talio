'use client'

import { useState, useEffect, useCallback } from 'react'
import { HiOutlineBellAlert, HiOutlineCheckCircle, HiOutlineCog6Tooth, HiXMark } from 'react-icons/hi2'

/**
 * Desktop Notification Permission Prompt
 * Shows a prompt in the Electron desktop app when notification permission
 * hasn't been verified. Asks user to test and enable notifications.
 * 
 * Only renders when running inside Electron (window.isElectron === true).
 */
export default function DesktopNotificationPrompt() {
  const [isElectron, setIsElectron] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const [testSuccess, setTestSuccess] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Only run in Electron
    const electron = typeof window !== 'undefined' && (window.isElectron === true || window.electronAPI !== undefined)
    setIsElectron(electron)

    if (!electron) return

    // Check if user already verified notifications recently
    const lastVerified = localStorage.getItem('desktop_notif_verified')
    if (lastVerified) {
      const verifiedTime = parseInt(lastVerified, 10)
      // Don't prompt again for 30 days after successful verification
      if (Date.now() - verifiedTime < 30 * 24 * 60 * 60 * 1000) {
        return
      }
    }

    // Check if prompt was dismissed recently
    const lastDismissed = localStorage.getItem('desktop_notif_dismissed')
    if (lastDismissed) {
      const dismissedTime = parseInt(lastDismissed, 10)
      // Don't show again for 3 days after dismissal
      if (Date.now() - dismissedTime < 3 * 24 * 60 * 60 * 1000) {
        return
      }
    }

    // Show prompt after a short delay (let the dashboard load first)
    const timer = setTimeout(() => {
      setShowPrompt(true)
    }, 5000)

    return () => clearTimeout(timer)
  }, [])

  const handleTestNotification = useCallback(async () => {
    if (!window.electronAPI?.testNotification) return

    try {
      const result = await window.electronAPI.testNotification()
      if (result.success) {
        setTestSuccess(true)
        localStorage.setItem('desktop_notif_verified', Date.now().toString())
        // Auto-close after showing success
        setTimeout(() => {
          setShowPrompt(false)
        }, 2000)
      }
    } catch (err) {
      console.error('[DesktopNotifPrompt] Test notification failed:', err)
    }
  }, [])

  const handleOpenSettings = useCallback(async () => {
    if (window.electronAPI?.openNotificationSettings) {
      await window.electronAPI.openNotificationSettings()
    }
  }, [])

  const handleDismiss = useCallback(() => {
    localStorage.setItem('desktop_notif_dismissed', Date.now().toString())
    setDismissed(true)
    setShowPrompt(false)
  }, [])

  if (!isElectron || !showPrompt || dismissed) return null

  // Success state
  if (testSuccess) {
    return (
      <div className="fixed bottom-20 md:bottom-4 right-4 md:w-[380px] z-50 animate-in slide-in-from-bottom-4 duration-300">
        <div className="relative rounded-2xl shadow-lg overflow-hidden" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-green-500" />
          <div className="px-6 py-5 text-center">
            <HiOutlineCheckCircle className="w-10 h-10 mx-auto mb-2 text-emerald-500" />
            <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
              Notifications Enabled!
            </h3>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              You&apos;ll receive desktop notifications for messages, tasks, and more.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed bottom-20 md:bottom-4 right-4 md:w-[400px] z-50 animate-in slide-in-from-bottom-4 duration-300">
      <div className="relative rounded-2xl shadow-lg overflow-hidden" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
        <div className="absolute top-0 left-0 right-0 h-1" style={{ background: 'linear-gradient(to right, var(--color-primary-500), var(--color-primary-300))' }} />

        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 p-1 rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/10"
        >
          <HiXMark className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
        </button>

        <div className="px-6 py-5">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--color-primary-50)' }}>
              <HiOutlineBellAlert className="w-5 h-5" style={{ color: 'var(--color-primary-500)' }} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                Enable Desktop Notifications
              </h3>
              <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
                Get notified about new messages, task assignments, announcements, and more — even when the app is minimized.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleTestNotification}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90"
                  style={{ background: 'var(--color-primary-500)' }}
                >
                  Test Notifications
                </button>
                <button
                  onClick={handleOpenSettings}
                  className="px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5"
                  style={{ color: 'var(--color-text-secondary)', background: 'var(--color-bg-hover, rgba(0,0,0,0.05))' }}
                >
                  <HiOutlineCog6Tooth className="w-3.5 h-3.5" />
                  Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
