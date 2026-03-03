'use client'

import { useEffect, useState, useRef } from 'react'
import { usePathname } from 'next/navigation'

/**
 * RouteProgressBar - Slim progress bar at the top of the page during navigation
 * Similar to NProgress/YouTube loading bar
 * Shows immediately on route change and completes when new page loads
 */
export default function RouteProgressBar() {
  const pathname = usePathname()
  const [progress, setProgress] = useState(0)
  const [isVisible, setIsVisible] = useState(false)
  const prevPathRef = useRef(pathname)
  const timerRef = useRef(null)
  const completeTimerRef = useRef(null)

  useEffect(() => {
    // Pathname changed = navigation happening
    if (prevPathRef.current !== pathname) {
      // Start progress
      setIsVisible(true)
      setProgress(0)

      // Animate progress in steps
      let step = 0
      clearInterval(timerRef.current)

      // Quick initial jump
      setTimeout(() => setProgress(30), 50)

      timerRef.current = setInterval(() => {
        step++
        setProgress(prev => {
          if (prev >= 90) {
            clearInterval(timerRef.current)
            return 90
          }
          // Slow down as we approach end
          const increment = Math.max(1, (90 - prev) / 10)
          return Math.min(90, prev + increment)
        })
      }, 200)

      // Complete transition
      clearTimeout(completeTimerRef.current)
      completeTimerRef.current = setTimeout(() => {
        setProgress(100)
        clearInterval(timerRef.current)

        // Hide after completion animation
        setTimeout(() => {
          setIsVisible(false)
          setProgress(0)
        }, 300)
      }, 150)

      prevPathRef.current = pathname
    }

    return () => {
      clearInterval(timerRef.current)
      clearTimeout(completeTimerRef.current)
    }
  }, [pathname])

  if (!isVisible) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[99999] pointer-events-none"
      style={{ height: '3px' }}
    >
      <div
        className="h-full bg-primary transition-all duration-300 ease-out"
        style={{
          width: `${progress}%`,
          boxShadow: progress > 0 ? '0 0 10px rgba(0, 102, 255, 0.5), 0 0 5px rgba(0, 102, 255, 0.3)' : 'none',
          opacity: progress === 100 ? 0 : 1,
          transition: progress === 100
            ? 'width 150ms ease-out, opacity 300ms ease-out 150ms'
            : 'width 300ms ease-out',
        }}
      />
    </div>
  )
}
