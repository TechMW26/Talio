'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  FaUsers, FaCalendarAlt, FaUserPlus,
  FaBriefcase, FaFileAlt, FaUserClock, FaUserTimes,
  FaExclamationCircle
} from 'react-icons/fa'
import toast from '@/utils/toast'
import { formatDesignation } from '@/lib/formatters'
import { getEmployeeId } from '@/utils/userHelper'
import { CustomizableDashboard } from '@/components/dashboard'
import CallAlertButton from '@/components/CallAlertButton'
import useRealtimeDashboard from '@/hooks/useRealtimeDashboard'
import {
  CheckInOutWidget,
  QuickGlanceWidget,
  KPIStatsWidget,
  LeaveRequestsWidget,
  DepartmentChartWidget,
  ProjectTasksWidgetWrapper,
  AttendanceSummaryWidget,
  TeamAttendanceWidget,
  EmployeeDirectoryWidget,
  LeaveBalanceWidget,
  QuickActionsWidget,
  AnnouncementsWidget,
  HolidaysWidget
} from '@/components/widgets'

// Fetch HR dashboard data
const fetchHRStats = async () => {
  try {
    const token = localStorage.getItem('token')
    const response = await fetch('/api/dashboard/hr-stats', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    const data = await response.json()
    return data.success ? data.data : null
  } catch (error) {
    console.error('Error fetching HR stats:', error)
    return null
  }
}

export default function HRDashboard({ user }) {
  const router = useRouter()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [todayAttendance, setTodayAttendance] = useState(null)
  const [attendanceLoading, setAttendanceLoading] = useState(false)
  const [employeeData, setEmployeeData] = useState(null)
  const [remainingTime, setRemainingTime] = useState(28800) // 8 hours in seconds (08:00)
  const [isCountingDown, setIsCountingDown] = useState(false)
  const [leaveRequests, setLeaveRequests] = useState([])
  const [employees, setEmployees] = useState([])

  // Get employee ID once - works whether user.employeeId is string or object
  const employeeIdStr = getEmployeeId(user)

  useEffect(() => {
    // Immediately set basic cached data from localStorage
    if (typeof window !== 'undefined') {
      const cachedUser = localStorage.getItem('user')
      if (cachedUser) {
        try {
          const parsed = JSON.parse(cachedUser)
          if (parsed.employeeCode || parsed.firstName) {
            setEmployeeData(prev => prev || {
              employeeCode: parsed.employeeCode,
              firstName: parsed.firstName,
              lastName: parsed.lastName,
              designation: parsed.designation,
              profilePicture: parsed.profilePicture
            })
          }
        } catch (e) { }
      }
    }

    const loadStats = async () => {
      const promises = [fetchHRStats(), fetchLeaveRequests(), fetchEmployees()]
      if (employeeIdStr) {
        promises.push(fetchTodayAttendance())
        promises.push(fetchEmployeeData())
      }

      const [hrStats] = await Promise.all(promises)
      setStats(hrStats)
      setLoading(false)
    }
    loadStats()
  }, [employeeIdStr])

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

  const fetchLeaveRequests = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/leave?status=pending&limit=5', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setLeaveRequests(data.data || [])
      }
    } catch (error) {
      console.error('Fetch leave requests error:', error)
    }
  }

  const fetchEmployees = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/employees?limit=10', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setEmployees(data.data || [])
      }
    } catch (error) {
      console.error('Fetch employees error:', error)
    }
  }

  // Callback for refreshing dashboard data on real-time events
  const refreshDashboard = useCallback(async () => {
    console.log('[HRDashboard] Real-time refresh triggered')
    const [hrStats] = await Promise.all([
      fetchHRStats(),
      fetchLeaveRequests(),
      fetchEmployees(),
      employeeIdStr ? fetchTodayAttendance() : Promise.resolve(),
      employeeIdStr ? fetchEmployeeData() : Promise.resolve()
    ])
    setStats(hrStats)
  }, [employeeIdStr])

  // Subscribe to real-time updates
  useRealtimeDashboard({ onDashboardRefresh: refreshDashboard })

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

  const handleLeaveAction = async (leaveId, action, reason = '') => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/leave/${leaveId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          action,
          reason,
          approvedBy: user?.employeeId,
        }),
      })

      const data = await response.json()
      if (data.success) {
        toast.success(`Leave request ${action}d successfully`)
        fetchLeaveRequests() // Refresh data
      } else {
        toast.error(data.message || `Failed to ${action} leave request`)
      }
    } catch (error) {
      console.error(`${action} leave error:`, error)
      toast.error(`Failed to ${action} leave request`)
    }
  }

  // Create stats cards data from API response
  const getStatsData = () => {
    if (!stats) return []
    return [
      {
        title: 'Total Employees',
        value: stats.totalEmployees?.value?.toString() || '0',
        change: `${stats.totalEmployees?.changePercent || 0}%`,
        icon: FaUsers,
        color: 'stat-icon-blue',
        trend: stats.totalEmployees?.trend || 'up',
        href: '/dashboard/employees'
      },
      {
        title: 'Active Today',
        value: `${stats.activeToday?.value || 0}/${stats.activeToday?.total || 0}`,
        change: `${stats.activeToday?.percentage || 0}%`,
        icon: FaUserClock,
        color: 'stat-icon-green',
        trend: 'up',
        href: '/dashboard/attendance'
      },
      {
        title: 'On Leave Today',
        value: stats.onLeaveToday?.value?.toString() || '0',
        change: `${stats.onLeaveToday?.percentage || 0}%`,
        icon: FaCalendarAlt,
        color: 'stat-icon-yellow',
        trend: 'neutral',
        href: '/dashboard/leave'
      },
      {
        title: 'Late Today',
        value: stats.lateToday?.value?.toString() || '0',
        change: `${stats.lateToday?.percentage || 0}%`,
        icon: FaUserTimes,
        color: 'stat-icon-red',
        trend: 'down',
        href: '/dashboard/attendance'
      },
      {
        title: 'Pending Approvals',
        value: stats.pendingApprovals?.leaves?.toString() || '0',
        change: 'Leaves',
        icon: FaExclamationCircle,
        color: 'stat-icon-orange',
        trend: 'neutral',
        href: '/dashboard/leave/approvals'
      },
      {
        title: 'Open Positions',
        value: stats.openPositions?.value?.toString() || '0',
        change: 'Active',
        icon: FaBriefcase,
        color: 'stat-icon-purple',
        trend: 'up',
        href: '/dashboard/recruitment'
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
        leaveRequests={leaveRequests}
        onApprove={(id) => handleLeaveAction(id, 'approve')}
        onReject={(id) => handleLeaveAction(id, 'reject', 'Rejected by HR')}
        onViewAll={() => router.push('/dashboard/leave/approvals')}
      />
    ),
    'department-distribution': (
      <DepartmentChartWidget
        departmentStats={stats?.departmentStats || []}
      />
    ),
    'project-tasks': (
      <ProjectTasksWidgetWrapper
        limit={5}
        showPendingAcceptance={true}
      />
    ),
    'employee-directory': (
      <EmployeeDirectoryWidget
        employees={employees}
        onViewDetails={(employee) => router.push(`/dashboard/employees/${employee._id}`)}
        onEdit={(employee) => router.push(`/dashboard/employees/edit/${employee._id}`)}
        onViewAll={() => router.push('/dashboard/employees')}
      />
    ),
    'quick-actions': (
      <QuickActionsWidget
        actions={[
          { name: 'Add Employee', icon: 'FaUserPlus', href: '/dashboard/employees/add', color: 'green' },
          { name: 'Review Leaves', icon: 'FaCalendarAlt', href: '/dashboard/leave/approvals', color: 'blue' },
          { name: 'Manage Jobs', icon: 'FaBriefcase', href: '/dashboard/recruitment', color: 'purple' },
          { name: 'Generate Reports', icon: 'FaFileAlt', href: '/dashboard/reports', color: 'red' },
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
      <MyAssetsWidget />
    ),
    'my-expenses': (
      <MyExpensesWidget />
    ),
    'my-helpdesk': (
      <MyHelpdeskWidget />
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
    leaveRequests,
    employees,
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
        userId={user?._id || 'hr'}
        userRole={user?.role || 'hr'}
        widgetComponents={widgetComponents}
      />
    </div>
  )
}
