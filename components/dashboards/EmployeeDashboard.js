'use client'

import { useState, useEffect, useMemo } from 'react'
import toast from 'react-hot-toast'
import {
  FaClock, FaCalendarAlt, FaMoneyBillWave, FaFileAlt,
  FaGraduationCap, FaAward, FaUser
} from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { formatDesignation } from '@/lib/formatters'
import { useTheme } from '@/contexts/ThemeContext'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import { CustomizableDashboard } from '@/components/dashboard'
import CallAlertButton from '@/components/CallAlertButton'
import {
  CheckInOutWidget,
  QuickGlanceWidget,
  AttendanceSummaryWidget,
  LeaveBalanceWidget,
  AnnouncementsWidget,
  HolidaysWidget,
  ProjectTasksWidgetWrapper,
  QuickActionsWidget,
  RecentActivitiesWidget,
  TodayTasksWidget,
  GoalsWidget,
  BirthdayWidget,
  MyAssetsWidget,
  MyExpensesWidget,
  MyHelpdeskWidget,
  PoliciesWidget
} from '@/components/widgets'

export default function EmployeeDashboard({ user: userProp }) {
  const router = useRouter()
  const { theme } = useTheme()

  // Fallback theme colors if theme is not loaded yet
  const primaryColor = theme?.primary?.[500] || '#3B82F6'

  const [loading, setLoading] = useState(true)
  const [dashboardStats, setDashboardStats] = useState(null)
  const [todayAttendance, setTodayAttendance] = useState(null)
  const [attendanceLoading, setAttendanceLoading] = useState(false)
  const [user, setUser] = useState(userProp)
  const [remainingTime, setRemainingTime] = useState(28800) // 8 hours in seconds (08:00)
  const [isCountingDown, setIsCountingDown] = useState(false)

  // Initialize with cached user data for instant display
  const [employeeData, setEmployeeData] = useState(() => {
    if (userProp?.employeeId && typeof userProp.employeeId === 'object') return userProp.employeeId
    if (userProp?.employeeCode || userProp?.firstName) {
      return {
        employeeCode: userProp.employeeCode,
        firstName: userProp.firstName,
        lastName: userProp.lastName,
        designation: userProp.designation,
        profilePicture: userProp.profilePicture
      }
    }
    return null
  })

  // Get employee ID string for API calls
  const employeeIdStr = getEmployeeId(user)

  // Load user from localStorage if not provided via props
  useEffect(() => {
    if (!userProp || !userProp.employeeId) {
      const parsedUser = getCurrentUser()
      if (parsedUser) {
        setUser(parsedUser)
      }
    } else {
      setUser(userProp)
    }
  }, [userProp])

  useEffect(() => {
    const loadAllData = async () => {
      const promises = [fetchDashboardData()]
      if (employeeIdStr) {
        promises.push(fetchTodayAttendance())
        promises.push(fetchEmployeeData())
      }
      await Promise.allSettled(promises)
    }
    loadAllData()
  }, [user, employeeIdStr])

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

  const fetchDashboardData = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')

      const response = await fetch('/api/dashboard/employee-stats', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()

      if (data.success) {
        setDashboardStats(data.data)
      }
    } catch (error) {
      console.error('Fetch dashboard data error:', error)
      toast.error('Failed to load dashboard data')
    } finally {
      setLoading(false)
    }
  }

  const fetchTodayAttendance = async () => {
    try {
      const employeeId = getEmployeeId(user)

      if (!employeeId) {
        console.warn('⚠️ Cannot fetch attendance - no employeeId')
        return
      }

      const token = localStorage.getItem('token')
      const today = new Date().toISOString().split('T')[0]

      const response = await fetch(`/api/attendance?employeeId=${employeeId}&date=${today}`, {
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
      const employeeId = getEmployeeId(user)
      if (!employeeId) return

      const token = localStorage.getItem('token')
      const response = await fetch(`/api/employees/${employeeId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      if (data.success && data.data) {
        setEmployeeData(data.data)
      }
    } catch (error) {
      console.error('Fetch employee data error:', error)
    }
  }

  const handleClockIn = async () => {
    const employeeId = getEmployeeId(user)

    if (!employeeId) {
      toast.error('User information not available. Please logout and login again.')
      return
    }

    setAttendanceLoading(true)

    try {
      // Get user's location - REQUIRED for clock in
      let latitude = null
      let longitude = null
      let address = 'Location not available'

      if (!navigator.geolocation) {
        toast.error('Geolocation is not supported by your browser')
        setAttendanceLoading(false)
        return
      }

      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15000,
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
          console.warn('⚠️ Geocoding failed:', geocodeError)
          address = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
        }
      } catch (geoError) {
        console.error('❌ Geolocation error:', geoError)

        let errorMessage = 'Location access is required for attendance'

        if (geoError.code === 1) {
          errorMessage = 'Please enable location permission in your browser settings to clock in'
        } else if (geoError.code === 2) {
          errorMessage = 'Location unavailable. Please check your device GPS settings'
        } else if (geoError.code === 3) {
          errorMessage = 'Location request timed out. Please try again'
        }

        toast.error(errorMessage, { duration: 5000 })
        setAttendanceLoading(false)
        return
      }

      // Validate that we have location data
      if (!latitude || !longitude) {
        toast.error('Unable to get your location. Please enable location services and try again')
        setAttendanceLoading(false)
        return
      }

      const token = localStorage.getItem('token')
      const response = await fetch('/api/attendance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          employeeId: employeeId,
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
      console.error('❌ Clock in error:', error)
      toast.error('An error occurred while clocking in')
    } finally {
      setAttendanceLoading(false)
    }
  }

  const handleClockOut = async () => {
    const employeeId = getEmployeeId(user)

    if (!employeeId) {
      toast.error('User information not available. Please logout and login again.')
      return
    }

    setAttendanceLoading(true)

    try {
      // Get user's location - REQUIRED for clock out
      let latitude = null
      let longitude = null
      let address = 'Location not available'

      if (!navigator.geolocation) {
        toast.error('Geolocation is not supported by your browser')
        setAttendanceLoading(false)
        return
      }

      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15000,
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
          console.warn('⚠️ Geocoding failed:', geocodeError)
          address = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
        }
      } catch (geoError) {
        console.error('❌ Geolocation error:', geoError)

        let errorMessage = 'Location access is required for attendance'

        if (geoError.code === 1) {
          errorMessage = 'Please enable location permission in your browser settings to clock out'
        } else if (geoError.code === 2) {
          errorMessage = 'Location unavailable. Please check your device GPS settings'
        } else if (geoError.code === 3) {
          errorMessage = 'Location request timed out. Please try again'
        }

        toast.error(errorMessage, { duration: 5000 })
        setAttendanceLoading(false)
        return
      }

      // Validate that we have location data
      if (!latitude || !longitude) {
        toast.error('Unable to get your location. Please enable location services and try again')
        setAttendanceLoading(false)
        return
      }

      const token = localStorage.getItem('token')
      const response = await fetch('/api/attendance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          employeeId: employeeId,
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
      console.error('❌ Clock out error:', error)
      toast.error('An error occurred while clocking out')
    } finally {
      setAttendanceLoading(false)
    }
  }

  // Create dynamic stats data
  const getStatsData = () => {
    if (!dashboardStats) return []

    return [
      {
        title: 'Hours This Month',
        value: `${dashboardStats.stats?.hoursThisMonth?.value || 0}h`,
        change: `${(dashboardStats.stats?.hoursThisMonth?.change || 0) >= 0 ? '+' : ''}${dashboardStats.stats?.hoursThisMonth?.change || 0}h`,
        icon: FaClock,
        color: primaryColor,
        trend: dashboardStats.stats?.hoursThisMonth?.trend || 'up',
        href: '/dashboard/attendance'
      },
      {
        title: 'Leave Balance',
        value: `${dashboardStats.stats?.leaveBalance?.value || 0} days`,
        change: `${(dashboardStats.stats?.leaveBalance?.change || 0) >= 0 ? '+' : ''}${dashboardStats.stats?.leaveBalance?.change || 0}`,
        icon: FaCalendarAlt,
        color: primaryColor,
        trend: dashboardStats.stats?.leaveBalance?.trend || 'neutral',
        href: '/dashboard/leave'
      },
      {
        title: 'This Month Salary',
        value: `₹${(dashboardStats.stats?.thisMonthSalary?.value || 0).toLocaleString()}`,
        change: `${(dashboardStats.stats?.thisMonthSalary?.change || 0) >= 0 ? '+' : ''}₹${Math.abs(dashboardStats.stats?.thisMonthSalary?.change || 0).toLocaleString()}`,
        icon: FaMoneyBillWave,
        color: primaryColor,
        trend: dashboardStats.stats?.thisMonthSalary?.trend || 'up',
        href: '/dashboard/payroll/payslips'
      },
      {
        title: 'Pending Tasks',
        value: `${dashboardStats.stats?.pendingTasks?.value || 0}`,
        change: `${(dashboardStats.stats?.pendingTasks?.change || 0) >= 0 ? '+' : ''}${dashboardStats.stats?.pendingTasks?.change || 0}`,
        icon: FaFileAlt,
        color: primaryColor,
        trend: dashboardStats.stats?.pendingTasks?.trend || 'neutral',
        href: '/dashboard/tasks'
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
    'announcements': (
      <AnnouncementsWidget />
    ),
    'holidays': (
      <HolidaysWidget limit={5} />
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
          { name: 'Mark Attendance', icon: 'FaClock', href: '/dashboard/attendance', color: 'green' },
          { name: 'Apply Leave', icon: 'FaCalendarAlt', href: '/dashboard/leave/apply', color: 'blue' },
          { name: 'View Payslip', icon: 'FaMoneyBillWave', href: '/dashboard/payroll/payslips', color: 'purple' },
          { name: 'My Profile', icon: 'FaUser', href: '/dashboard/profile', color: 'red' },
        ]}
      />
    ),
    'recent-activities': (
      <RecentActivitiesWidget />
    ),
    'today-tasks': (
      <TodayTasksWidget />
    ),
    'goals-widget': (
      <GoalsWidget userId={user?._id} />
    ),
    'birthday-widget': (
      <BirthdayWidget />
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
    handleClockIn,
    handleClockOut,
    formatCountdown
  ])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* Call Alert Button - Fixed position for easy access (only shows for department heads) */}
      <div className="fixed bottom-6 right-6 z-40">
        <CallAlertButton user={user} />
      </div>

      <CustomizableDashboard
        userId={user?._id || 'employee'}
        userRole={user?.role || 'employee'}
        widgetComponents={widgetComponents}
      />
    </div>
  )
}
