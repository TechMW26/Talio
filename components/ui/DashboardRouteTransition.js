'use client'

import { usePathname } from 'next/navigation'
import { usePageTransition } from '@/contexts/PageTransitionContext'

/**
 * Keeps the persistent dashboard shell visible while route content changes.
 * The animation is CSS-driven so navigation does not wait for JavaScript
 * animation frames and users with reduced-motion preferences get an instant
 * transition.
 */
export default function DashboardRouteTransition({ children }) {
  const pathname = usePathname()
  const { isNavigating } = usePageTransition()

  return (
    <div
      className={`dashboard-route-stage ${isNavigating ? 'is-navigating' : ''}`}
      data-navigation-state={isNavigating ? 'loading' : 'idle'}
    >
      <div key={pathname} className="dashboard-route-page">
        {children}
      </div>

      <div
        aria-hidden="true"
        className={`dashboard-route-veil ${isNavigating ? 'is-active' : ''}`}
      >
        <div className="dashboard-route-grid" />
        <div className="dashboard-route-orb" />
        <div className="dashboard-route-scan" />
      </div>
    </div>
  )
}
