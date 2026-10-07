'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
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
  const contentRef = useRef(null)
  useEffect(() => {
    const root = contentRef.current
    if (!root || !window.matchMedia || !window.MutationObserver) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const selector = '[data-page-skeleton], [data-slot="skeleton"]:not([data-loaded="true"]), [aria-busy="true"], .animate-pulse'
    const loading = () => [...root.querySelectorAll(selector)].some(node => !node.closest('[hidden]'))
    let wasLoading = loading(), frame
    const animations = new Set()
    const stop = () => { animations.forEach(animation => animation.cancel()); animations.clear() }
    const observer = new MutationObserver(() => {
      const nowLoading = loading()
      if (wasLoading && !nowLoading && !media.matches) {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          if (media.matches || loading() || root.hidden) return
          // Replay on real content, without remounting stateful forms or editors.
          const targets = [...root.querySelectorAll('h1, h2, article, section, [data-fernly-element]')]
            .filter(node => !node.closest('[hidden], [role="dialog"], [data-mira]'))
            .filter(node => !node.parentElement?.closest('article, section, [data-fernly-element]'))
          for (const [index, node] of (targets.length ? targets : [root.firstElementChild]).filter(Boolean).entries()) {
            if (!node.animate) continue
            const animation = node.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 550, delay: Math.min(index, 6) * 45, easing: 'cubic-bezier(.22,1,.36,1)' })
            animations.add(animation)
            animation.onfinish = () => animations.delete(animation)
          }
        })
      }
      wasLoading = nowLoading
    })
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy', 'data-loaded', 'hidden', 'class'] })
    media.addEventListener('change', stop)
    return () => { observer.disconnect(); cancelAnimationFrame(frame); stop(); media.removeEventListener('change', stop) }
  }, [pathname])
  const { isNavigating, targetPath } = usePageTransition()
  const pending = isNavigating && targetPath && targetPath !== pathname
  const viewport = /^\/dashboard\/team\/members\/[^/]+$/.test(pathname || '') || pathname === '/dashboard/chat' || pathname === '/dashboard'
  const title = pending ? targetPath.split('/').filter(Boolean).at(-1).replace(/-/g, ' ') : ''

  return (
    <div
      className={`dashboard-route-stage ${isNavigating ? 'is-navigating' : ''}`}
      data-navigation-state={isNavigating ? 'loading' : 'idle'}
    >
      {pending && <div role="status" aria-label="Loading page" className="dashboard-loading-surface capitalize"><PageSkeleton title={title} showLoader={false} /></div>}
      <div ref={contentRef} hidden={Boolean(pending)} key={pathname} data-page-sizing={viewport ? 'viewport' : 'document'} className="dashboard-route-page dashboard-page-canvas">
        {children}
      </div>

    </div>
  )
}
