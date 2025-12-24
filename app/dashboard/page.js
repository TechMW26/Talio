'use client'

import { useEffect, useState } from 'react'
import AdminDashboard from '@/components/dashboards/AdminDashboard'
import HRDashboard from '@/components/dashboards/HRDashboard'
import ManagerDashboard from '@/components/dashboards/ManagerDashboard'
import EmployeeDashboard from '@/components/dashboards/EmployeeDashboard'

// Lightweight skeleton for faster perceived loading
function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="animate-pulse space-y-4">
        {/* Header skeleton */}
        <div className="h-16 bg-white rounded-xl shadow-sm"></div>
        {/* KPI cards skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-24 bg-white rounded-xl shadow-sm"></div>
          ))}
        </div>
        {/* Widget grid skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="h-48 bg-white rounded-xl shadow-sm"></div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Helper function to render role-based dashboard
const renderDashboardByRole = (user) => {
  switch (user?.role) {
    case 'admin':
    case 'department_head':
      return <AdminDashboard user={user} />
    case 'hr':
      return <HRDashboard user={user} />
    case 'manager':
      return <ManagerDashboard user={user} />
    case 'employee':
    default:
      return <EmployeeDashboard user={user} />
  }
}

export default function DashboardPage() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Immediately try to get user from localStorage
    try {
      const userData = localStorage.getItem('user')
      if (userData) {
        setUser(JSON.parse(userData))
      }
    } catch (e) {
      console.error('[Dashboard] Failed to parse user data:', e)
    }
    setLoading(false)

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

  return renderDashboardByRole(user)
}

