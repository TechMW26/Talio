'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

const STORAGE_KEY = 'talio_last_url'

function isElectronApp() {
  if (typeof window === 'undefined') return false
  if (window.electronAPI) return true
  if (window.talioDesktop?.isDesktopApp) return true
  if (navigator.userAgent.toLowerCase().includes('electron')) return true
  return false
}

function isRecoverableRuntimeError(message = '') {
  const normalized = String(message).toLowerCase()
  return (
    normalized.includes('chunkloaderror') ||
    normalized.includes('loading chunk') ||
    normalized.includes('dynamically imported module') ||
    normalized.includes('importing a module script failed') ||
    normalized.includes('networkerror') ||
    normalized.includes('failed to fetch')
  )
}

export default function WebNetworkRecovery() {
  const router = useRouter()
  const [visible, setVisible] = useState(false)
  const [message, setMessage] = useState('Connection changed. If screen looks blank, recover the page.')
  const hideTimerRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined' || isElectronApp()) return

    const showRecovery = (nextMessage, autoHideMs = 15000) => {
      setMessage(nextMessage)
      setVisible(true)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      if (autoHideMs > 0) {
        hideTimerRef.current = setTimeout(() => setVisible(false), autoHideMs)
      }
    }

    const handleOnline = () => {
      window.dispatchEvent(new CustomEvent('talio:soft-refresh', { detail: { reason: 'network-reconnected' } }))
      showRecovery('Connection restored. If the UI looks blank, click Recover.', 20000)
    }

    const handleError = (event) => {
      const msg = event?.message || event?.error?.message || ''
      if (isRecoverableRuntimeError(msg)) {
        showRecovery('A network/chunk loading issue was detected. Click Recover to restore the app.', 0)
      }
    }

    const handleUnhandledRejection = (event) => {
      const reasonMessage = event?.reason?.message || event?.reason || ''
      if (isRecoverableRuntimeError(reasonMessage)) {
        showRecovery('A loading error occurred during network change. Click Recover to continue.', 0)
      }
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  const handleSoftRecover = () => {
    try {
      const lastUrl = localStorage.getItem(STORAGE_KEY)
      if (lastUrl && !lastUrl.includes('/offline')) {
        const parsed = new URL(lastUrl)
        router.replace(parsed.pathname + parsed.search)
      }
      router.refresh()
      setVisible(false)
    } catch {
      window.location.reload()
    }
  }

  const handleHardRecover = () => {
    window.location.reload()
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100000] max-w-sm rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-lg">
      <p className="text-sm font-medium text-amber-900">{message}</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={handleSoftRecover}
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
        >
          Recover
        </button>
        <button
          type="button"
          onClick={handleHardRecover}
          className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
        >
          Hard Reload
        </button>
      </div>
    </div>
  )
}
