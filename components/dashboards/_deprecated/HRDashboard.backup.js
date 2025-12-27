'use client'

import { useEffect, useState } from 'react'
import {
  FaUsers, FaCalendarAlt, FaUserPlus,
  FaArrowUp, FaArrowDown, FaBriefcase, FaFileAlt,
  FaExclamationCircle, FaUserClock, FaUserTimes,
  FaChartLine, FaExclamationTriangle, FaUser, FaSignInAlt,
  FaSignOutAlt, FaCheckCircle, FaClock
} from 'react-icons/fa'
import toast from 'react-hot-toast'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { formatDesignation } from '@/lib/formatters'
import CustomTooltip, { CustomPieTooltip } from '@/components/charts/CustomTooltip'
import { getEmployeeId } from '@/utils/userHelper'
import ProjectTasksWidget from './ProjectTasksWidget'
import DraggableKPIGrid from '@/components/dashboard/DraggableKPIGrid'
import DraggableDashboardSections from '@/components/dashboard/DraggableDashboardSections'

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
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [todayAttendance, setTodayAttendance] = useState(null)
  const [attendanceLoading, setAttendanceLoading] = useState(false)
  const [employeeData, setEmployeeData] = useState(null)
  const [remainingTime, setRemainingTime] = useState(28800) // 8 hours in seconds (08:00)
  const [isCountingDown, setIsCountingDown] = useState(false)

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
      const data = await fetchHRStats()
      setStats(data)
      setLoading(false)
    }
    loadStats()
    // Use employeeIdStr which is properly extracted
    if (employeeIdStr) {
      fetchTodayAttendance()
      fetchEmployeeData()
    }
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

  if (loading) {
    return (
      <div className="page-container">
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        </div>
      </div>
    )
  }

  // Create stats cards data from API response
  const hrStatsData = stats ? [
    {
      title: 'Total Employees',
      value: stats.totalEmployees.value.toString(),
      change: `${stats.totalEmployees.changePercent}%`,
      icon: FaUsers,
      color: 'stat-icon-blue',
      trend: stats.totalEmployees.trend
    },
    {
      title: 'Active Today',
      value: `${stats.activeToday.value}/${stats.activeToday.total}`,
      change: `${stats.activeToday.percentage}%`,
      icon: FaUserClock,
      color: 'stat-icon-green',
      trend: 'up'
    },
    {
      title: 'On Leave Today',
      value: stats.onLeaveToday.value.toString(),
      change: `${stats.onLeaveToday.percentage}%`,
      icon: FaCalendarAlt,
      color: 'stat-icon-yellow',
      trend: 'neutral'
    },
    {
      title: 'Late Today',
      value: stats.lateToday.value.toString(),
      change: `${stats.lateToday.percentage}%`,
      icon: FaUserTimes,
      color: 'stat-icon-red',
      trend: 'down'
    },
    {
      title: 'Pending Approvals',
      value: stats.pendingApprovals.leaves.toString(),
      change: 'Leaves',
      icon: FaExclamationCircle,
      color: 'stat-icon-orange',
      trend: 'neutral'
    },
    {
      title: 'Open Positions',
      value: stats.openPositions.value.toString(),
      change: 'Active',
      icon: FaBriefcase,
      color: 'stat-icon-purple',
      trend: 'up'
    },
    {
      title: 'PIP Cases',
      value: stats.pipCases.value.toString(),
      change: 'Active',
      icon: FaExclamationTriangle,
      color: 'stat-icon-red',
      trend: 'neutral'
    },
    {
      title: 'Attrition Rate',
      value: `${stats.attritionRate.value}%`,
      change: `${stats.attritionRate.leftThisMonth} left`,
      icon: FaChartLine,
      color: 'stat-icon-purple',
      trend: stats.attritionRate.value > 5 ? 'up' : 'down'
    }
  ] : []

  // Define dashboard sections for draggable layout
  const dashboardSections = [
    {
      id: 'check-in-out',
      component: (
        <div style={{ background: 'var(--color-accent-gradient)' }} className="rounded-2xl shadow-md p-4 sm:p-6 text-white">
          {/* User Profile Section */}
          <div className="flex items-center gap-3 mb-4">
            {/* Profile Picture */}
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center flex-shrink-0">
              {employeeData?.profilePicture ? (
                <img
                  src={employeeData.profilePicture}
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              ) : (
                <FaUser className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
              )}
            </div>

            {/* User Name and ID */}
            <div>
              <p className="text-xs text-gray-300 mb-0.5">
                ID: {employeeData?.employeeCode || user?.employeeCode || user?.employeeNumber || '---'}
              </p>
              <h2 className="text-lg sm:text-xl md:text-2xl font-bold uppercase tracking-wide">
                {employeeData ? `${employeeData.firstName} ${employeeData.lastName}` :
                  (user?.firstName && user?.lastName
                    ? `${user.firstName} ${user.lastName}`
                    : 'User')}
              </h2>
              {(employeeData?.designation || user?.designation) && (
                <p className="text-xs text-gray-300 mt-0.5">
                  {formatDesignation(employeeData?.designation || user?.designation)}
                </p>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 sm:gap-3">
            <button
              onClick={handleClockIn}
              disabled={attendanceLoading || (todayAttendance && todayAttendance.checkIn)}
              className="btn-theme-primary disabled:opacity-50 disabled:cursor-not-allowed px-4 sm:px-5 py-2 sm:py-2.5 rounded-lg font-semibold text-sm shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center flex-1"
            >
              <span>Check In</span>
            </button>

            <button
              onClick={handleClockOut}
              disabled={attendanceLoading || !todayAttendance || !todayAttendance.checkIn || todayAttendance.checkOut}
              className="btn-theme-secondary disabled:opacity-50 disabled:cursor-not-allowed px-4 sm:px-5 py-2 sm:py-2.5 rounded-lg font-semibold text-sm shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center flex-1"
            >
              <span>Check Out</span>
            </button>
          </div>
        </div>
      )
    },
    {
      id: 'quick-glance',
      component: (
        <div style={{ backgroundColor: 'var(--color-bg-card)' }} className="rounded-2xl p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base sm:text-lg font-bold text-gray-800">Quick Glance</h3>

            {/* Countdown Timer */}
            <div className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${isCountingDown
                ? remainingTime > 3600
                  ? 'bg-green-100'
                  : remainingTime > 1800
                    ? 'bg-yellow-100'
                    : 'bg-red-100'
                : 'bg-gray-100'
                }`}>
                <FaClock className={`w-3.5 h-3.5 ${isCountingDown
                  ? remainingTime > 3600
                    ? 'text-green-600'
                    : remainingTime > 1800
                      ? 'text-yellow-600'
                      : 'text-red-600'
                  : 'text-gray-600'
                  }`} />
                <span className={`text-sm sm:text-base font-bold ${isCountingDown
                  ? remainingTime > 3600
                    ? 'text-green-700'
                    : remainingTime > 1800
                      ? 'text-yellow-700'
                      : 'text-red-700'
                  : 'text-gray-700'
                  }`}>
                  {formatCountdown(remainingTime)}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {/* Check In Time */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-4 h-4 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary-100)' }}>
                  <FaSignInAlt className="w-2.5 h-2.5" style={{ color: 'var(--color-primary-600)' }} />
                </div>
                <p className="text-xs font-medium text-gray-600">Check In Time</p>
              </div>
              <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-primary-50)' }}>
                <p className="text-lg sm:text-xl md:text-2xl font-bold text-gray-800">
                  {todayAttendance?.checkIn
                    ? new Date(todayAttendance.checkIn).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true
                    })
                    : '--:--'}
                </p>
              </div>
            </div>

            {/* Check Out Time */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-4 h-4 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary-100)' }}>
                  <FaSignOutAlt className="w-2.5 h-2.5" style={{ color: 'var(--color-primary-600)' }} />
                </div>
                <p className="text-xs font-medium text-gray-600">Check Out Time</p>
              </div>
              <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-primary-50)' }}>
                <p className="text-lg sm:text-xl md:text-2xl font-bold text-gray-800">
                  {todayAttendance?.checkOut
                    ? new Date(todayAttendance.checkOut).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true
                    })
                    : '--:--'}
                </p>
              </div>
            </div>

            {/* Work Hours */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-4 h-4 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary-100)' }}>
                  <FaClock className="w-2.5 h-2.5" style={{ color: 'var(--color-primary-600)' }} />
                </div>
                <p className="text-xs font-medium text-gray-600">Work Hours</p>
              </div>
              <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-primary-50)' }}>
                <p className="text-lg sm:text-xl md:text-2xl font-bold text-gray-800">
                  {todayAttendance?.workHours
                    ? `${todayAttendance.workHours}h`
                    : '--:--'}
                </p>
              </div>
            </div>

            {/* Work Status */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-4 h-4 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary-100)' }}>
                  <FaCheckCircle className="w-2.5 h-2.5" style={{ color: 'var(--color-primary-600)' }} />
                </div>
                <p className="text-xs font-medium text-gray-600">Work Status</p>
              </div>
              <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-primary-50)' }}>
                <p className="text-sm sm:text-base md:text-lg font-bold text-gray-800 capitalize">
                  {todayAttendance?.workFromHome ? 'WFH' :
                    todayAttendance?.status === 'present' ? 'Present' :
                      todayAttendance?.status === 'half-day' ? 'Half Day' :
                        todayAttendance?.status === 'in-progress' ? 'In Progress' :
                          todayAttendance?.status === 'on-leave' ? 'On Leave' :
                            'Absent'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'welcome-section',
      component: (
        <div style={{ background: 'var(--color-accent-gradient)' }} className="rounded-lg p-3 sm:p-6 text-white">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">HR Dashboard 👥</h1>
          <p className="opacity-90 text-sm sm:text-base">Manage people, processes, and organizational growth</p>
          {stats && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold">{stats.totalEmployees.value}</div>
                <div className="text-green-100 text-sm">Total Employees</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{stats.genderRatio.malePercent}% / {stats.genderRatio.femalePercent}%</div>
                <div className="text-green-100 text-sm">Male / Female</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{stats.attendanceRate.value}%</div>
                <div className="text-green-100 text-sm">Attendance Rate</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{stats.newHires.value}</div>
                <div className="text-green-100 text-sm">New Hires</div>
              </div>
            </div>
          )}
        </div>
      )
    },
    {
      id: 'kpi-stats',
      component: (
        <DraggableKPIGrid
          stats={hrStatsData}
          userId={user?._id || 'hr'}
          showTrend={true}
          gridClassName="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6"
        />
      )
    },
    stats && {
      id: 'charts',
      component: (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-8">
          {/* Department Distribution */}
          <div style={{ backgroundColor: 'var(--color-bg-card)' }} className="rounded-lg overflow-hidden">
            <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-2">
              <h3 className="text-sm sm:text-base font-bold text-gray-800">Department Distribution</h3>
            </div>
            <div className="h-80 sm:h-80 pr-4 sm:pr-6 pb-4 sm:pb-6">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.departmentStats} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" />
                  <XAxis dataKey="_id" fontSize={9} tick={{ fontSize: 9, fill: '#6b7280' }} stroke="#9ca3af" />
                  <YAxis fontSize={9} tick={{ fontSize: 9, fill: '#6b7280' }} stroke="#9ca3af" width={35} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" fill="var(--color-primary-500)" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Gender Ratio */}
          <div style={{ backgroundColor: 'var(--color-bg-card)' }} className="rounded-lg overflow-hidden">
            <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-2">
              <h3 className="text-sm sm:text-base font-bold text-gray-800">Gender Distribution</h3>
            </div>
            <div className="h-80 sm:h-80 pr-4 sm:pr-6 pb-4 sm:pb-6">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Male', value: stats.genderRatio.male, color: '#3b82f6' },
                      { name: 'Female', value: stats.genderRatio.female, color: '#ec4899' }
                    ]}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {[
                      { name: 'Male', value: stats.genderRatio.male, color: '#3b82f6' },
                      { name: 'Female', value: stats.genderRatio.female, color: '#ec4899' }
                    ].map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomPieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )
    },
    stats && {
      id: 'key-metrics',
      component: (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Today's Attendance Summary */}
          <div className="rounded-lg shadow-md p-6" style={{ backgroundColor: 'var(--color-bg-card)' }}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Today&apos;s Attendance</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Present</span>
                <span className="font-semibold text-green-600">{stats.activeToday.value}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">On Leave</span>
                <span className="font-semibold text-yellow-600">{stats.onLeaveToday.value}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Late</span>
                <span className="font-semibold text-red-600">{stats.lateToday.value}</span>
              </div>
              <div className="pt-2 border-t">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-900">Attendance Rate</span>
                  <span className="font-bold" style={{ color: 'var(--color-primary-600)' }}>{stats.attendanceRate.value}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* System Health */}
          <div className="rounded-lg shadow-md p-6" style={{ backgroundColor: 'var(--color-bg-card)' }}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">System Health</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Attrition Rate</span>
                <span className={`font-semibold ${stats.attritionRate.value > 5 ? 'text-red-600' : 'text-green-600'}`}>
                  {stats.attritionRate.value}%
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">PIP Cases</span>
                <span className={`font-semibold ${stats.pipCases.value > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {stats.pipCases.value}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Open Positions</span>
                <span className="font-semibold" style={{ color: 'var(--color-primary-600)' }}>{stats.openPositions.value}</span>
              </div>
              <div className="pt-2 border-t">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-900">Payroll Status</span>
                  <span className={`font-bold ${stats.payrollStatus.generated ? 'text-green-600' : 'text-yellow-600'}`}>
                    {stats.payrollStatus.generated ? 'Generated' : 'Pending'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="rounded-lg shadow-md p-6" style={{ backgroundColor: 'var(--color-bg-card)' }}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
            <div className="space-y-3">
              <a
                href="/dashboard/employees/add"
                className="flex items-center p-3 quick-action-blue rounded-lg transition-all duration-200"
              >
                <FaUserPlus className="w-5 h-5 mr-3 icon" />
                <span className="text-sm font-medium text">Add Employee</span>
              </a>
              <a
                href="/dashboard/leave/approvals"
                className="flex items-center p-3 quick-action-blue rounded-lg transition-all duration-200"
              >
                <FaCalendarAlt className="w-5 h-5 mr-3 icon" />
                <span className="text-sm font-medium text">
                  Review Leaves ({stats.pendingApprovals.leaves})
                </span>
              </a>
              <a
                href="/dashboard/recruitment"
                className="flex items-center p-3 quick-action-blue rounded-lg transition-all duration-200"
              >
                <FaBriefcase className="w-5 h-5 mr-3 icon" />
                <span className="text-sm font-medium text">Manage Jobs</span>
              </a>
              <a
                href="/dashboard/reports"
                className="flex items-center p-3 quick-action-blue rounded-lg transition-all duration-200"
              >
                <FaFileAlt className="w-5 h-5 mr-3 icon" />
                <span className="text-sm font-medium text">Generate Reports</span>
              </a>
            </div>
          </div>
        </div>
      )
    },
    stats && {
      id: 'system-alerts',
      component: (
        <div className="rounded-lg shadow-md p-6" style={{ backgroundColor: 'var(--color-bg-card)' }}>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">System Alerts</h3>
          <div className="space-y-3">
            {stats.pipCases.value > 0 && (
              <div className="flex items-center p-3 bg-red-50 rounded-lg">
                <FaExclamationTriangle className="w-5 h-5 text-red-600 mr-3" />
                <div>
                  <p className="text-sm font-medium text-red-900">
                    {stats.pipCases.value} employee(s) on Performance Improvement Plan
                  </p>
                  <p className="text-xs text-red-700">Requires immediate attention</p>
                </div>
              </div>
            )}

            {stats.attritionRate.value > 5 && (
              <div className="flex items-center p-3 bg-yellow-50 rounded-lg">
                <FaChartLine className="w-5 h-5 text-yellow-600 mr-3" />
                <div>
                  <p className="text-sm font-medium text-yellow-900">
                    High attrition rate: {stats.attritionRate.value}%
                  </p>
                  <p className="text-xs text-yellow-700">Consider retention strategies</p>
                </div>
              </div>
            )}

            {stats.lateToday.value > (stats.totalEmployees.value * 0.1) && (
              <div className="flex items-center p-3 bg-orange-50 rounded-lg">
                <FaUserTimes className="w-5 h-5 text-orange-600 mr-3" />
                <div>
                  <p className="text-sm font-medium text-orange-900">
                    High late arrivals today: {stats.lateToday.value} employees
                  </p>
                  <p className="text-xs text-orange-700">Review attendance policies</p>
                </div>
              </div>
            )}

            {!stats.payrollStatus.generated && (
              <div className="flex items-center p-3 bg-blue-50 rounded-lg">
                <FaFileAlt className="w-5 h-5 text-blue-600 mr-3" />
                <div>
                  <p className="text-sm font-medium text-blue-900">
                    Payroll pending for {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </p>
                  <p className="text-xs text-blue-700">Generate payslips before month end</p>
                </div>
              </div>
            )}

            {stats.pendingApprovals.leaves > 0 && (
              <div className="flex items-center p-3 bg-purple-50 rounded-lg">
                <FaCalendarAlt className="w-5 h-5 text-purple-600 mr-3" />
                <div>
                  <p className="text-sm font-medium text-purple-900">
                    {stats.pendingApprovals.leaves} leave request(s) pending approval
                  </p>
                  <p className="text-xs text-purple-700">Review and approve pending requests</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )
    },
    {
      id: 'project-tasks',
      component: <ProjectTasksWidget limit={5} showPendingAcceptance={true} />
    }
  ].filter(Boolean)

  return (
    <div className="page-container">
      <DraggableDashboardSections
        sections={dashboardSections}
        userId={user?._id || 'hr'}
        storageKey="hr-dashboard"
      />
    </div>
  )
}
