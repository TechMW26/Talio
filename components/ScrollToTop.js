'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Scrolls the page to the top whenever the route (pathname) changes.
 * Rendered once inside Providers / layout.
 */
export default function ScrollToTop() {
  const pathname = usePathname()

  useEffect(() => {
    // Use requestAnimationFrame to ensure DOM has settled after navigation
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    })
  }, [pathname])

  return null
}
