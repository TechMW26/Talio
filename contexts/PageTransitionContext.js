'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

const PageTransitionContext = createContext()

/**
 * PageTransitionProvider - Provides page transition loading state
 * Exposes targetPath for optimistic active-state highlighting in sidebar/bottomnav
 */
export function PageTransitionProvider({ children }) {
  const [isNavigating, setIsNavigating] = useState(false)
  const [targetPath, setTargetPath] = useState(null)
  const pathname = usePathname()
  const prevPathnameRef = useRef(pathname)

  // When pathname changes, navigation is complete
  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      // Route actually changed — navigation complete
      prevPathnameRef.current = pathname
      // Small delay to let the page render before clearing the loading state
      const timer = setTimeout(() => {
        setIsNavigating(false)
        setTargetPath(null)
      }, 80)
      return () => clearTimeout(timer)
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
