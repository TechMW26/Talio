'use client'

import { useEffect, useState, useRef } from 'react'
import { usePageTransition } from '@/contexts/PageTransitionContext'

/**
 * RouteProgressBar - Slim progress bar at the top of the page during navigation
 * Similar to NProgress/YouTube loading bar
 * Driven by PageTransitionContext for instant feedback on link click
 */
export default function RouteProgressBar() {
  const { isNavigating } = usePageTransition()
  const [progress, setProgress] = useState(0)
  const [isVisible, setIsVisible] = useState(false)
  const timerRef = useRef(null)
  const hideTimerRef = useRef(null)

  useEffect(() => {
    if (isNavigating) {
      // Start - show immediately
      clearTimeout(hideTimerRef.current)
      setIsVisible(true)
      setProgress(0)

      // Quick initial jump
      requestAnimationFrame(() => setProgress(30))

      // Trickle progress
      clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) {
            clearInterval(timerRef.current)
            return 90
          }
          return prev + Math.max(0.5, (90 - prev) / 8)
        })
      }, 250)
    } else if (isVisible) {
      // Navigation complete - finish the bar
      clearInterval(timerRef.current)
      setProgress(100)

      hideTimerRef.current = setTimeout(() => {
        setIsVisible(false)
        setProgress(0)
      }, 400)
    }

    return () => {
      clearInterval(timerRef.current)
      clearTimeout(hideTimerRef.current)
    }
  }, [isNavigating])

  if (!isVisible) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[99999] pointer-events-none"
      style={{ height: '3px' }}
    >
      <div
        className="h-full"
        style={{
          width: `${progress}%`,
          background: 'linear-gradient(90deg, var(--color-primary-400), var(--color-primary-600))',
          boxShadow: progress > 0 && progress < 100
            ? '0 0 12px rgba(0, 102, 255, 0.5), 0 0 4px rgba(0, 102, 255, 0.3)'
            : 'none',
          opacity: progress === 100 ? 0 : 1,
          transition: progress === 0
            ? 'none'
            : progress === 100
              ? 'width 200ms ease-out, opacity 400ms ease-out 100ms'
              : 'width 300ms ease-out',
        }}
      />
    </div>
  )
}
