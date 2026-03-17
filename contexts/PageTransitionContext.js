'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

const PageTransitionContext = createContext()

/**
 * PageTransitionProvider - Provides page transition loading state
 * Exposes targetPath for optimistic active-state highlighting in sidebar/bottomnav
 * Automatically intercepts all internal link clicks for global coverage
 */
export function PageTransitionProvider({ children }) {
  const [isNavigating, setIsNavigating] = useState(false)
  const [targetPath, setTargetPath] = useState(null)
  const pathname = usePathname()
  const prevPathnameRef = useRef(pathname)
  const pathnameRef = useRef(pathname)

  // Keep pathnameRef in sync
  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])

  // When pathname changes, navigation is complete
  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      // Route actually changed — clear immediately so spinner doesn't linger
      prevPathnameRef.current = pathname
      setIsNavigating(false)
      setTargetPath(null)
      return
    }
    // Safety: if navigating but pathname hasn't changed after 5s, clear stuck state
    if (isNavigating) {
      const maxTimeout = setTimeout(() => {
        setIsNavigating(false)
        setTargetPath(null)
      }, 5000)
      return () => clearTimeout(maxTimeout)
    }
  }, [pathname, isNavigating])

  // Intercept all internal link clicks globally so every navigation shows the spinner
  useEffect(() => {
    const handleClick = (e) => {
      // Find the closest anchor tag
      const anchor = e.target.closest('a')
      if (!anchor) return

      const href = anchor.getAttribute('href')
      if (!href) return

      // Skip external links, hash links, mailto, tel, blob, download links
      if (
        href.startsWith('http') ||
        href.startsWith('//') ||
        href.startsWith('#') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('blob:') ||
        anchor.hasAttribute('download') ||
        anchor.target === '_blank'
      ) return

      // Skip same-page navigation
      const path = href.split('?')[0].split('#')[0]
      if (path === pathnameRef.current) return

      // Skip non-dashboard links (login, etc.) — they leave this layout
      if (!path.startsWith('/dashboard')) return

      setTargetPath(path)
      setIsNavigating(true)
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [])

  // Intercept programmatic router.push / router.replace via history.pushState
  // Patch once and use refs to access current pathname to avoid re-patching
  useEffect(() => {
    const originalPushState = history.pushState.bind(history)
    const originalReplaceState = history.replaceState.bind(history)

    const handleStateChange = (url) => {
      if (!url) return
      // Handle both string and URL object
      const urlStr = typeof url === 'object' && url !== null ? url.toString() : String(url)
      try {
        // Parse relative or absolute URLs
        const parsed = new URL(urlStr, window.location.origin)
        const path = parsed.pathname
        if (path === pathnameRef.current) return
        if (!path.startsWith('/dashboard')) return
        setTargetPath(path)
        setIsNavigating(true)
      } catch {
        // Fallback for simple path strings
        const path = urlStr.split('?')[0].split('#')[0]
        if (path === pathnameRef.current) return
        if (!path.startsWith('/dashboard')) return
        setTargetPath(path)
        setIsNavigating(true)
      }
    }

    history.pushState = function (state, title, url) {
      handleStateChange(url)
      return originalPushState(state, title, url)
    }

    history.replaceState = function (state, title, url) {
      handleStateChange(url)
      return originalReplaceState(state, title, url)
    }

    // Also handle browser back/forward
    const handlePopState = () => {
      const path = window.location.pathname
      if (path !== pathnameRef.current && path.startsWith('/dashboard')) {
        setTargetPath(path)
        setIsNavigating(true)
      }
    }

    window.addEventListener('popstate', handlePopState)

    return () => {
      history.pushState = originalPushState
      history.replaceState = originalReplaceState
      window.removeEventListener('popstate', handlePopState)
    }
  }, []) // Run once — uses refs for current pathname

  // Call this when starting navigation
  const startNavigation = useCallback((path) => {
    // Don't show loading for same page navigation
    if (path === pathname) return
    setTargetPath(path)
    setIsNavigating(true)
  }, [pathname])

  // Call this when navigation is cancelled or complete
  const endNavigation = useCallback(() => {
    setIsNavigating(false)
    setTargetPath(null)
  }, [])

  return (
    <PageTransitionContext.Provider value={{ isNavigating, targetPath, startNavigation, endNavigation }}>
      {children}
    </PageTransitionContext.Provider>
  )
}

/**
 * usePageTransition - Hook to access page transition state
 * Returns { isNavigating, targetPath, startNavigation, endNavigation }
 * - targetPath is the path being navigated to (for optimistic active-state highlighting)
 */
export function usePageTransition() {
  const context = useContext(PageTransitionContext)
  if (!context) {
    return { isNavigating: false, targetPath: null, startNavigation: () => { }, endNavigation: () => { } }
  }
  return context
}
