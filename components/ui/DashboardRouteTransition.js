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

      {/* RouteProgressBar indicates navigation without covering usable content. */}
    </div>
  )
}
