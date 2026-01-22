'use client'

import { useEffect, useState } from 'react'
import { Spinner, Skeleton, Card, CardBody } from '@heroui/react'
import UnifiedDashboard from '@/components/dashboards/UnifiedDashboard'

// Modern skeleton loader for dashboard using Hero UI
function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="space-y-6">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48 rounded-lg" />
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
        
        {/* KPI cards skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="shadow-sm">
              <CardBody className="p-4">
                <div className="space-y-3">
                  <Skeleton className="h-3 w-20 rounded-lg" />
                  <Skeleton className="h-8 w-24 rounded-lg" />
                  <Skeleton className="h-3 w-16 rounded-lg" />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
        
        {/* Widget grid skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Card key={i} className="shadow-sm">
              <CardBody className="p-4">
                <Skeleton className="h-4 w-32 rounded-lg mb-4" />
                <div className="space-y-3">
                  <Skeleton className="h-20 w-full rounded-lg" />
                  <Skeleton className="h-4 w-3/4 rounded-lg" />
                </div>
              </CardBody>
            </Card>
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

