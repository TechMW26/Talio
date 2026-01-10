'use client'

import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { usePathname } from 'next/navigation'

const PageTransitionContext = createContext()

/**
 * PageTransitionProvider - Provides page transition loading state
 * Shows loading overlay immediately when navigating between pages
 */
export function PageTransitionProvider({ children }) {
  const [isNavigating, setIsNavigating] = useState(false)
  const [targetPath, setTargetPath] = useState(null)
  const pathname = usePathname()

  // When pathname changes, navigation is complete
  useEffect(() => {
    if (isNavigating && pathname === targetPath) {
      // Small delay to ensure content is rendered
      const timer = setTimeout(() => {
        setIsNavigating(false)
        setTargetPath(null)
      }, 100)
      return () => clearTimeout(timer)
    }
    // Also clear loading after max timeout (3s) to prevent stuck states
    if (isNavigating) {
      const maxTimeout = setTimeout(() => {
        setIsNavigating(false)
        setTargetPath(null)
      }, 3000)
      return () => clearTimeout(maxTimeout)
    }
  }, [pathname, isNavigating, targetPath])

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
    <PageTransitionContext.Provider value={{ isNavigating, startNavigation, endNavigation }}>
      {children}
    </PageTransitionContext.Provider>
  )
}

/**
 * usePageTransition - Hook to access page transition state
 */
export function usePageTransition() {
  const context = useContext(PageTransitionContext)
  if (!context) {
    // Return safe defaults if used outside provider
    return { isNavigating: false, startNavigation: () => {}, endNavigation: () => {} }
  }
  return context
}
