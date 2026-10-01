'use client'

import { usePathname } from 'next/navigation'
import { usePageTransition } from '@/contexts/PageTransitionContext'
import PageSkeleton from './PageSkeleton'

/**
 * Keeps the persistent dashboard shell visible while route content changes.
 * The animation is CSS-driven so navigation does not wait for JavaScript
 * animation frames and users with reduced-motion preferences get an instant
 * transition.
 */
export default function DashboardRouteTransition({ children }) {
  const pathname = usePathname()
  const { isNavigating, targetPath } = usePageTransition()
  const pending = isNavigating && targetPath && targetPath !== pathname
  const title = pending ? targetPath.split('/').filter(Boolean).at(-1).replace(/-/g, ' ') : ''

  return (
    <div
      className={`dashboard-route-stage ${isNavigating ? 'is-navigating' : ''}`}
      data-navigation-state={isNavigating ? 'loading' : 'idle'}
    >
      {pending && <div role="status" aria-label="Loading page" className="capitalize"><PageSkeleton title={title} showLoader={false} /></div>}
      <div hidden={Boolean(pending)} key={pathname} className="dashboard-route-page dashboard-page-canvas">
        {children}
      </div>

    </div>
  )
}
