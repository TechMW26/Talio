'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  FaUsers, FaClock, FaCalendarAlt, FaChartLine,
  FaAward, FaExclamationCircle
} from 'react-icons/fa'
import toast from '@/utils/toast'
import { formatDesignation } from '@/lib/formatters'
import { useTheme } from '@/contexts/ThemeContext'
import { getEmployeeId } from '@/utils/userHelper'
import { CustomizableDashboard } from '@/components/dashboard'
import CallAlertButton from '@/components/CallAlertButton'
import {
  CheckInOutWidget,
  QuickGlanceWidget,
  KPIStatsWidget,
  LeaveRequestsWidget,
  ProjectTasksWidgetWrapper,
  AttendanceSummaryWidget,
  TeamAttendanceWidget,
  LeaveBalanceWidget,
  QuickActionsWidget,
  AnnouncementsWidget,
  HolidaysWidget,
  MyAssetsWidget,
  MyExpensesWidget,
  MyHelpdeskWidget,
  PoliciesWidget
} from '@/components/widgets'

export default function ManagerDashboard({ user }) {
  const router = useRouter()
  const { theme } = useTheme()

  // Fallback theme colors if theme is not loaded yet
  const primaryColor = theme?.primary?.[500] || '#3B82F6'
  const primaryDark = theme?.primary?.[600] || '#2563EB'

  // Initialize with cached user data for instant display
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [pendingLeaves, setPendingLeaves] = useState([])
  const [todayAttendance, setTodayAttendance] = useState(null)
  const [attendanceLoading, setAttendanceLoading] = useState(false)
  const [remainingTime, setRemainingTime] = useState(28800) // 8 hours in seconds (08:00)
  const [isCountingDown, setIsCountingDown] = useState(false)
  // Use user's employeeId data as initial state for instant display
  const [employeeData, setEmployeeData] = useState(() => {
    // Try to get cached employee data from user object
    if (user?.employeeId && typeof user.employeeId === 'object') {
      return user.employeeId
    }
    // Check if user has direct employee fields
    if (user?.employeeCode || user?.firstName) {
      return {
        employeeCode: user.employeeCode,
        firstName: user.firstName,
        lastName: user.lastName,
        designation: user.designation,
        profilePicture: user.profilePicture
      }
    }
    return null
  })

  // Get employee ID for API calls
  const employeeIdStr = getEmployeeId(user)

  useEffect(() => {
    // Load all data in PARALLEL for faster display
    const loadAllData = async () => {
      const promises = [
        fetchManagerStats(),
        fetchPendingLeaves()
      ]

      // Add employee-specific fetches if we have an employeeId
      if (employeeIdStr) {
        promises.push(fetchTodayAttendance())
        promises.push(fetchEmployeeData())
      }

      await Promise.allSettled(promises)
      setLoading(false)
    }

    loadAllData()
  }, [])

  // Countdown timer effect
  useEffect(() => {
    // Calculate remaining time based on check-in time
    if (todayAttendance?.checkIn && !todayAttendance?.checkOut) {
      const checkInTime = new Date(todayAttendance.checkIn).getTime()
      const now = Date.now()
      const elapsedSeconds = Math.floor((now - checkInTime) / 1000)
      const remaining = Math.max(0, 28800 - elapsedSeconds) // 8 hours - elapsed time

      setRemainingTime(remaining)
      setIsCountingDown(true)
    } else if (todayAttendance?.checkOut) {
      // User has checked out, stop countdown
      setIsCountingDown(false)
      setRemainingTime(0)
    } else {
      // No check-in yet, reset to 8 hours
      setRemainingTime(28800)
      setIsCountingDown(false)
    }
  }, [todayAttendance])

  // Timer interval
  useEffect(() => {
    if (!isCountingDown || remainingTime <= 0) return

    const interval = setInterval(() => {
      setRemainingTime((prev) => {
        if (prev <= 1) {
          setIsCountingDown(false)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [isCountingDown, remainingTime])

  // Format countdown time as HH:MM:SS
  const formatCountdown = (seconds) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  const fetchManagerStats = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/dashboard/manager-stats', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setStats(data.data)
      }
    } catch (error) {
      console.error('Error fetching manager stats:', error)
    }
  }

  const fetchPendingLeaves = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/team/leave-approvals', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setPendingLeaves(data.data.slice(0, 5)) // Show first 5 pending leaves
      }
    } catch (error) {
      console.error('Error fetching pending leaves:', error)
    }
  }

  const fetchTodayAttendance = async () => {
    try {
      const token = localStorage.getItem('token')
      const today = new Date().toISOString().split('T')[0]

      const response = await fetch(`/api/attendance?employeeId=${employeeIdStr}&date=${today}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      if (data.success && data.data.length > 0) {
        setTodayAttendance(data.data[0])
      }
    } catch (error) {
      console.error('Fetch today attendance error:', error)
    }
  }

  const fetchEmployeeData = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/employees/${employeeIdStr}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const result = await response.json()
      if (result.success) {
        setEmployeeData(result.data)
      }
    } catch (error) {
      console.error('Error fetching employee data:', error)
    }
  }

  const handleClockIn = async () => {
    if (!employeeIdStr) return
    setAttendanceLoading(true)

    try {
      // Get user's location
      let latitude = null
      let longitude = null
      let address = 'Location not available'

      if (navigator.geolocation) {
        try {
          const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0
            })
          })

          latitude = position.coords.latitude
          longitude = position.coords.longitude

          // Try to get address from coordinates
          try {
            const geocodeResponse = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
            )
            const geocodeData = await geocodeResponse.json()
            address = geocodeData.display_name || 'Location detected'
          } catch (geocodeError) {
            console.warn('Geocoding failed:', geocodeError)
            address = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
          }
        } catch (geoError) {
          console.warn('Geolocation error:', geoError)
          toast.error('Location access denied. Please enable location services.')
        }
      }

      const token = localStorage.getItem('token')
      const response = await fetch('/api/attendance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          employeeId: employeeIdStr,
          type: 'clock-in',
          latitude,
          longitude,
          address,
        }),
      })

      const data = await response.json()

      if (data.success) {
        toast.success('Clocked in successfully!')
        setTodayAttendance(data.data)
      } else {
        toast.error(data.message || 'Failed to clock in')
      }
    } catch (error) {
      console.error('Clock in error:', error)
      toast.error('An error occurred while clocking in')
    } finally {
      setAttendanceLoading(false)
    }
  }

  const handleClockOut = async () => {
    if (!employeeIdStr) return
    setAttendanceLoading(true)

    try {
      // Get user's location
      let latitude = null
      let longitude = null
      let address = 'Location not available'

      if (navigator.geolocation) {
        try {
          const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0
            })
          })

          latitude = position.coords.latitude
          longitude = position.coords.longitude

          // Try to get address from coordinates
          try {
            const geocodeResponse = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
            )
            const geocodeData = await geocodeResponse.json()
            address = geocodeData.display_name || 'Location detected'
          } catch (geocodeError) {
            console.warn('Geocoding failed:', geocodeError)
            address = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
          }
        } catch (geoError) {
          console.warn('Geolocation error:', geoError)
        }
      }

      const token = localStorage.getItem('token')
      const response = await fetch('/api/attendance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          employeeId: employeeIdStr,
          type: 'clock-out',
          latitude,
          longitude,
          address,
        }),
      })

      const data = await response.json()

      if (data.success) {
        toast.success('Clocked out successfully! 👋')
        setTodayAttendance(data.data)
      } else {
        toast.error(data.message || 'Failed to clock out')
      }
    } catch (error) {
      console.error('Clock out error:', error)
      toast.error('An error occurred while clocking out')
    } finally {
      setAttendanceLoading(false)
    }
  }

  const handleLeaveAction = async (leaveId, action, comments = '') => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/team/leave-approvals', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ leaveId, action, comments })
      })
      const data = await response.json()
      if (data.success) {
        toast.success(`Leave ${action} successfully`)
        fetchPendingLeaves()
        fetchManagerStats()
      } else {
        toast.error(data.message || `Failed to ${action} leave`)
      }
    } catch (error) {
      console.error(`${action} leave error:`, error)
      toast.error(`Failed to ${action} leave`)
    }
  }

  // Create stats data
  const getStatsData = () => {
    if (!stats) return []
    return [
      {
        title: 'Team Members',
        value: stats.teamStrength?.toString() || '0',
        change: '',
        icon: FaUsers,
        color: 'stat-icon-blue',
        trend: 'neutral',
        href: '/dashboard/team'
      },
      {
        title: 'Present Today',
        value: stats.attendanceSummary?.present?.toString() || '0',
        change: '',
        icon: FaClock,
        color: 'stat-icon-green',
        trend: 'up',
        href: '/dashboard/attendance'
      },
      {
        title: 'Pending Leaves',
        value: stats.pendingLeaveApprovals?.length?.toString() || '0',
        change: '',
        icon: FaCalendarAlt,
        color: 'stat-icon-yellow',
        trend: 'neutral',
        href: '/dashboard/leave/approvals'
      },
      {
        title: 'On Leave Today',
        value: stats.onLeaveToday?.length?.toString() || '0',
        change: '',
        icon: FaCalendarAlt,
        color: 'stat-icon-orange',
        trend: 'neutral',
        href: '/dashboard/leave'
      },
      {
        title: 'Team Performance',
        value: `${Math.round((stats.performanceStats?.averageRating || 0) * 20)}%`,
        change: '',
        icon: FaChartLine,
        color: 'bg-indigo-500',
        trend: 'up',
        href: '/dashboard/performance'
      },
      {
        title: 'Underperforming',
        value: stats.underperforming?.length?.toString() || '0',
        change: '',
        icon: FaExclamationCircle,
        color: 'bg-red-500',
        trend: 'down',
        href: '/dashboard/performance/ratings'
      },
    ]
  }

  const statsData = getStatsData()

  // Widget components mapping for the customizable dashboard
  // Must be defined before any conditional returns to follow React hooks rules
  const widgetComponents = useMemo(() => ({
    'check-in-out': (
      <CheckInOutWidget
        user={user}
        employeeData={employeeData}
        todayAttendance={todayAttendance}
        attendanceLoading={attendanceLoading}
        onClockIn={handleClockIn}
        onClockOut={handleClockOut}
        formatDesignation={formatDesignation}
      />
    ),
    'quick-glance': (
      <QuickGlanceWidget
        todayAttendance={todayAttendance}
        remainingTime={remainingTime}
        isCountingDown={isCountingDown}
        formatCountdown={formatCountdown}
      />
    ),
    'kpi-stats': (
      <KPIStatsWidget
        statsData={statsData}
        onCardClick={(stat) => router.push(stat.href)}
      />
    ),
    'leave-requests': (
      <LeaveRequestsWidget
        leaveRequests={pendingLeaves}
        onApprove={(id) => handleLeaveAction(id, 'approved')}
        onReject={(id) => handleLeaveAction(id, 'rejected', 'Rejected by manager')}
        onViewAll={() => router.push('/dashboard/leave/approvals')}
      />
    ),
    'project-tasks': (
      <ProjectTasksWidgetWrapper
        limit={5}
        showPendingAcceptance={true}
      />
    ),
    'quick-actions': (
      <QuickActionsWidget
        actions={[
          { name: 'Review Leaves', icon: 'FaCalendarAlt', href: '/dashboard/leave/approvals', color: 'blue' },
          { name: 'Team Ratings', icon: 'FaChartLine', href: '/dashboard/performance/ratings', color: 'purple' },
          { name: 'Create Review', icon: 'FaAward', href: '/dashboard/performance/create', color: 'green' },
          { name: 'Mark Attendance', icon: 'FaClock', href: '/dashboard/attendance', color: 'red' },
        ]}
      />
    ),
    'team-attendance': (
      <TeamAttendanceWidget />
    ),
    'announcements': (
      <AnnouncementsWidget />
    ),
    'attendance-summary': (
      <AttendanceSummaryWidget
        employeeId={getEmployeeId(user)}
      />
    ),
    'leave-balance': (
      <LeaveBalanceWidget
        userId={user?._id}
      />
    ),
    'holidays': (
      <HolidaysWidget limit={5} />
    ),
    'my-assets': (
      <MyAssetsWidget user={user} />
    ),
    'my-expenses': (
      <MyExpensesWidget user={user} />
    ),
    'my-helpdesk': (
      <MyHelpdeskWidget user={user} />
    ),
    'policies': (
      <PoliciesWidget />
    ),
  }), [
    user,
    employeeData,
    todayAttendance,
    attendanceLoading,
    remainingTime,
    isCountingDown,
    pendingLeaves,
    stats,
    statsData,
    router,
    handleClockIn,
    handleClockOut,
    handleLeaveAction,
    formatCountdown
  ])

  if (loading) {
    return (
      <div className="page-container">
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* Call Alert Button - Fixed position for easy access */}
      <div className="fixed bottom-6 right-6 z-40">
        <CallAlertButton user={user} />
      </div>

      <CustomizableDashboard
        userId={user?._id || 'manager'}
        userRole={user?.role || 'manager'}
        widgetComponents={widgetComponents}
      />
    </div>
  )
}
