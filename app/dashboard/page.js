'use client'

import { useEffect, useState } from 'react'
import UnifiedDashboard from '@/components/dashboards/UnifiedDashboard'

// Lightweight skeleton for faster perceived loading
function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="animate-pulse space-y-4">
        {/* Header skeleton */}
        <div className="h-16 bg-white rounded-xl shadow-sm"></div>
        {/* KPI cards skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-white rounded-xl shadow-sm"></div>
          ))}
        </div>
        {/* Widget grid skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-48 bg-white rounded-xl shadow-sm"></div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Clear the login redirect flag on successful dashboard load
    sessionStorage.removeItem('__login_redirecting')

    // Remove _auth param from URL (cleanup)
    if (typeof window !== 'undefined' && window.location.search.includes('_auth=local')) {
      const url = new URL(window.location.href)
      url.searchParams.delete('_auth')
      window.history.replaceState({}, '', url.pathname)
    }

    // Immediately try to get user from localStorage
    try {
      const userData = localStorage.getItem('user')
      const token = localStorage.getItem('token')

      if (userData && token) {
        setUser(JSON.parse(userData))
        setLoading(false)
      } else {
        // No auth data, redirect to login
        console.log('[Dashboard] No auth data found, redirecting to login...')
        window.location.href = '/login'
        return
      }
    } catch (e) {
      console.error('[Dashboard] Failed to parse user data:', e)
      window.location.href = '/login'
      return
    }

    // Play login success sound if coming from fresh login (defer to not block render)
    try {
      const shouldPlaySound = sessionStorage.getItem('playLoginSound')
      if (shouldPlaySound === 'true') {
        sessionStorage.removeItem('playLoginSound')
        // Defer sound to not block render
        setTimeout(async () => {
          try {
            const { unlockAudio, playLoginSuccessSound } = await import('@/utils/audio')
            await unlockAudio()
            await playLoginSuccessSound()
          } catch (err) {
            console.warn('[Dashboard] Login success sound failed:', err)
          }
        }, 500)
      }
    } catch (e) {
      // Ignore sessionStorage errors
    }
  }, [])

  if (loading) {
    return <DashboardSkeleton />
  }

  return <UnifiedDashboard user={user} />
}

