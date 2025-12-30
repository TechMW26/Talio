'use client'

import { useEffect, useState } from 'react'
import UnifiedDashboard from '@/components/dashboards/UnifiedDashboard'
import { MobileViewWrapper, MobileHome } from '@/components/MobileApp'

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

// Mobile skeleton
function MobileSkeleton() {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', padding: '16px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ height: '120px', background: 'white', borderRadius: '20px' }}></div>
        <div style={{ height: '80px', background: 'white', borderRadius: '16px' }}></div>
        <div style={{ height: '200px', background: 'white', borderRadius: '20px' }}></div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [dashboardData, setDashboardData] = useState(null)

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

  // Fetch dashboard data for mobile view
  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const token = localStorage.getItem('token')
        const [attendanceRes, statsRes] = await Promise.all([
          fetch('/api/attendance/today', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/dashboard/stats', { headers: { Authorization: `Bearer ${token}` } })
        ])
        
        const attendanceData = await attendanceRes.json()
        const statsData = await statsRes.json()
        
        setDashboardData({
          todayAttendance: attendanceData.success ? attendanceData.data : null,
          stats: statsData.success ? statsData.data : null
        })
      } catch (err) {
        console.error('[Dashboard] Failed to fetch mobile data:', err)
      }
    }
    
    if (user) {
      fetchDashboardData()
    }
  }, [user])

  if (loading) {
    return (
      <MobileViewWrapper
        mobileContent={<MobileSkeleton />}
        desktopContent={<DashboardSkeleton />}
      />
    )
  }

  // Render with mobile/desktop conditional
  return (
    <MobileViewWrapper
      mobileContent={
        <MobileHome 
          user={user} 
          attendance={dashboardData?.todayAttendance}
          stats={dashboardData?.stats}
        />
      }
      desktopContent={<UnifiedDashboard user={user} />}
    />
  )
}

