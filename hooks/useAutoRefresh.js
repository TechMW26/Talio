'use client'

import { useEffect, useRef, useCallback } from 'react'

function isElectronApp() {
  if (typeof window === 'undefined') return false
  if (window.electronAPI) return true
  if (window.talioDesktop?.isDesktopApp) return true
  if (navigator.userAgent.toLowerCase().includes('electron')) return true
  return false
}

/**
 * Auto-refresh hook that triggers page refresh on:
 * 1. User inactivity (default 5 minutes)
 * 2. Tab visibility change (user returns to tab after being away)
 * 3. Device wake from sleep (laptop lid open)
 * 
 * @param {Object} options
 * @param {number} options.inactivityTimeout - Inactivity timeout in milliseconds (default: 5 minutes)
 * @param {boolean} options.refreshOnVisibilityChange - Whether to refresh when tab becomes visible (default: true)
 * @param {number} options.minAwayTime - Minimum time away before refresh on return (default: 2 minutes)
 * @param {boolean} options.enabled - Whether the hook is enabled (default: true)
 * @param {function} options.onRefresh - Optional callback before refresh (for cleanup)
 */
export default function useAutoRefresh({
  inactivityTimeout = 5 * 60 * 1000, // 5 minutes
  refreshOnVisibilityChange = true,
  minAwayTime = 2 * 60 * 1000, // 2 minutes minimum away time before refresh
  enabled = true,
  onRefresh = null,
  onSoftRefresh = null,
  hardRefreshOnInactivity = false
} = {}) {
  const inactivityTimerRef = useRef(null)
  const lastActivityRef = useRef(Date.now())
  const lastVisibleRef = useRef(Date.now())
  const isRefreshingRef = useRef(false)

  // Perform refresh with optional callback
  const performRefresh = useCallback(({ hard = false, reason = 'auto-refresh' } = {}) => {
    if (isRefreshingRef.current) return
    isRefreshingRef.current = true

    console.log(`🔄 [AutoRefresh] Triggering ${hard ? 'hard' : 'soft'} refresh (${reason})...`)
    
    // Call optional cleanup callback
    if (onRefresh && typeof onRefresh === 'function') {
      try {
        onRefresh()
      } catch (error) {
        console.error('[AutoRefresh] Error in onRefresh callback:', error)
      }
    }

    const shouldHardRefresh = hard || isElectronApp()

    if (shouldHardRefresh) {
      window.location.reload()
      return
    }

    try {
      if (onSoftRefresh && typeof onSoftRefresh === 'function') {
        onSoftRefresh({ reason })
      } else {
        window.dispatchEvent(new CustomEvent('talio:soft-refresh', { detail: { reason } }))
      }
    } catch (error) {
      console.warn('[AutoRefresh] Soft refresh failed, falling back to hard refresh:', error)
      window.location.reload()
      return
    }

    setTimeout(() => {
      isRefreshingRef.current = false
    }, 1500)
  }, [onRefresh, onSoftRefresh])

  // Reset inactivity timer
  const resetInactivityTimer = useCallback(() => {
    lastActivityRef.current = Date.now()
    
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current)
    }

    if (enabled) {
      inactivityTimerRef.current = setTimeout(() => {
        console.log('⏰ [AutoRefresh] Inactivity timeout reached')
        performRefresh({ hard: hardRefreshOnInactivity, reason: 'inactivity-timeout' })
      }, inactivityTimeout)
    }
  }, [enabled, inactivityTimeout, performRefresh, hardRefreshOnInactivity])

  // Handle visibility change (tab focus/blur, laptop lid open/close)
  const handleVisibilityChange = useCallback(() => {
    if (!enabled || !refreshOnVisibilityChange) return

    if (document.visibilityState === 'visible') {
      const timeAway = Date.now() - lastVisibleRef.current
      console.log(`👁️ [AutoRefresh] Tab visible again after ${Math.round(timeAway / 1000)}s`)

      // Refresh if user was away for more than minAwayTime
      if (timeAway >= minAwayTime) {
        console.log('🔄 [AutoRefresh] User was away long enough, refreshing...')
        performRefresh({ reason: 'visibility-return' })
      } else {
        // Just reset the inactivity timer
        resetInactivityTimer()
      }
    } else {
      // Tab hidden - record the time
      lastVisibleRef.current = Date.now()
    }
  }, [enabled, refreshOnVisibilityChange, minAwayTime, performRefresh, resetInactivityTimer])

  // Handle page show event (more reliable for laptop wake)
  const handlePageShow = useCallback((event) => {
    if (!enabled) return

    // persisted is true when page is restored from bfcache (back/forward cache)
    // This often happens when laptop wakes from sleep
    if (event.persisted) {
      console.log('📱 [AutoRefresh] Page restored from cache (likely device wake)')
      const timeAway = Date.now() - lastVisibleRef.current
      
      if (timeAway >= minAwayTime) {
        performRefresh({ reason: 'pageshow-persisted' })
      }
    }
  }, [enabled, minAwayTime, performRefresh])

  // Handle online event (network reconnection after sleep)
  const handleOnline = useCallback(() => {
    if (!enabled) return

    const timeAway = Date.now() - lastActivityRef.current
    console.log(`🌐 [AutoRefresh] Back online after ${Math.round(timeAway / 1000)}s`)

    // If we've been inactive for a while and just came back online, refresh
    if (timeAway >= minAwayTime) {
      performRefresh({ reason: 'network-reconnected' })
    }
  }, [enabled, minAwayTime, performRefresh])

  // Handle focus event (window regains focus)
  const handleFocus = useCallback(() => {
    if (!enabled || !refreshOnVisibilityChange) return

    const timeAway = Date.now() - lastActivityRef.current
    
    // Only refresh if inactive for more than minAwayTime
    if (timeAway >= minAwayTime) {
      console.log('🎯 [AutoRefresh] Window focused after long inactivity')
      performRefresh({ reason: 'window-focus' })
    } else {
      resetInactivityTimer()
    }
  }, [enabled, refreshOnVisibilityChange, minAwayTime, performRefresh, resetInactivityTimer])

  useEffect(() => {
    if (!enabled) return

    // User activity events to track
    const activityEvents = [
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
      'click'
    ]

    // Throttled activity handler (don't reset on every tiny movement)
    let throttleTimer = null
    const throttledResetTimer = () => {
      if (throttleTimer) return
      throttleTimer = setTimeout(() => {
        resetInactivityTimer()
        throttleTimer = null
      }, 1000) // Throttle to once per second
    }

    // Add activity listeners
    activityEvents.forEach(event => {
      document.addEventListener(event, throttledResetTimer, { passive: true })
    })

    // Add visibility and focus listeners
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('online', handleOnline)
    window.addEventListener('focus', handleFocus)

    // Start the initial inactivity timer
    resetInactivityTimer()

    // Initialize lastVisible to now
    lastVisibleRef.current = Date.now()

    console.log('✅ [AutoRefresh] Initialized with', {
      inactivityTimeout: `${inactivityTimeout / 1000}s`,
      minAwayTime: `${minAwayTime / 1000}s`,
      refreshOnVisibilityChange
    })

    // Cleanup
    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current)
      }
      if (throttleTimer) {
        clearTimeout(throttleTimer)
      }

      activityEvents.forEach(event => {
        document.removeEventListener(event, throttledResetTimer)
      })

      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('focus', handleFocus)
    }
  }, [
    enabled,
    inactivityTimeout,
    minAwayTime,
    refreshOnVisibilityChange,
    resetInactivityTimer,
    handleVisibilityChange,
    handlePageShow,
    handleOnline,
    handleFocus
  ])

  // Return a manual refresh function if needed
  return { refresh: performRefresh }
}
