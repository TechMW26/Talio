'use client'

import { useState, useEffect } from 'react'
import {
  FaUsers, FaClock, FaCalendarAlt, FaChartLine,
  FaArrowUp, FaArrowDown, FaTasks, FaAward,
  FaExclamationCircle, FaCheckCircle, FaUser,
  FaSignInAlt, FaSignOutAlt
} from 'react-icons/fa'
import toast from 'react-hot-toast'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { formatDesignation } from '@/lib/formatters'
import { useTheme } from '@/contexts/ThemeContext'
import CustomTooltip from '@/components/charts/CustomTooltip'
import { getEmployeeId, getDesignationText } from '@/utils/userHelper'
import ProjectTasksWidget from './ProjectTasksWidget'
import DraggableKPIGrid from '@/components/dashboard/DraggableKPIGrid'
import DraggableDashboardSections from '@/components/dashboard/DraggableDashboardSections'

export default function ManagerDashboard({ user }) {
  const { theme } = useTheme()

  // Fallback theme colors if theme is not loaded yet
  const primaryColor = theme?.primary?.[500] || '#3B82F6'
  const primaryDark = theme?.primary?.[600] || '#2563EB'

  // Initialize with cached user data for instant display
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [teamMembers, setTeamMembers] = useState([])
  const [pendingLeaves, setPendingLeaves] = useState([])
  const [recentActivities, setRecentActivities] = useState([])
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
        fetchTeamMembers(),
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
        setRecentActivities(data.data.recentActivities || [])
      }
    } catch (error) {
      console.error('Error fetching manager stats:', error)
    }
  }

  const fetchTeamMembers = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/team/members', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setTeamMembers(data.data.slice(0, 5)) // Show first 5 members
      }
    } catch (error) {
      console.error('Error fetching team members:', error)
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
        setPendingLeaves(data.data.slice(0, 3)) // Show first 3 pending leaves
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
        // Sync to localStorage for faster future loads
        if (typeof window !== 'undefined') {
          try {
            const currentUser = JSON.parse(localStorage.getItem('user') || '{}')
            const updatedUser = {
              ...currentUser,
              employeeCode: result.data.employeeCode,
              firstName: result.data.firstName,
              lastName: result.data.lastName,
              designation: result.data.designation,
              profilePicture: result.data.profilePicture
            }
            localStorage.setItem('user', JSON.stringify(updatedUser))
          } catch (e) { /* ignore sync errors */ }
        }
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

  const handleApproveLeave = async (leaveId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/team/leave-approvals', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ leaveId, action: 'approved' })
      })
      const data = await response.json()
      if (data.success) {
        alert('Leave approved successfully')
        fetchPendingLeaves()
        fetchManagerStats()
      }
    } catch (error) {
      console.error('Error approving leave:', error)
    }
  }

  const handleRejectLeave = async (leaveId) => {
    const comments = prompt('Please provide a reason for rejection:')
    if (!comments) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/team/leave-approvals', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ leaveId, action: 'rejected', comments })
      })
      const data = await response.json()
      if (data.success) {
        alert('Leave rejected successfully')
        fetchPendingLeaves()
        fetchManagerStats()
      }
    } catch (error) {
      console.error('Error rejecting leave:', error)
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="page-container">
        <div className="rounded-lg shadow-md p-8 text-center" style={{ backgroundColor: 'var(--color-bg-card)' }}>
          <p className="text-gray-600">Unable to load manager dashboard data</p>
        </div>
      </div>
    )
  }

  const managerStatsData = [
    { title: 'Team Members', value: stats.teamStrength.toString(), change: '', icon: FaUsers, color: 'stat-icon-blue', trend: 'neutral' },
    { title: 'Present Today', value: stats.attendanceSummary.present.toString(), change: '', icon: FaClock, color: 'stat-icon-green', trend: 'up' },
    { title: 'Pending Leaves', value: stats.pendingLeaveApprovals.length.toString(), change: '', icon: FaCalendarAlt, color: 'stat-icon-yellow', trend: 'neutral' },
    { title: 'On Leave Today', value: stats.onLeaveToday.length.toString(), change: '', icon: FaCalendarAlt, color: 'stat-icon-orange', trend: 'neutral' },
    { title: 'Team Performance', value: `${Math.round(stats.performanceStats.averageRating * 20)}%`, change: '', icon: FaChartLine, color: 'bg-indigo-500', trend: 'up' },
    { title: 'Underperforming', value: stats.underperforming.length.toString(), change: '', icon: FaExclamationCircle, color: 'bg-red-500', trend: 'down' },
  ]

  // Prepare attendance chart data (last 5 days)
  const teamAttendanceData = stats.weeklyAttendance || []

  // Prepare performance trend data
  const performanceData = stats.performanceTrend || []

  // Helper functions for team activities section
  const getActivityColor = (type, status) => {
    if (type === 'leave') {
      return status === 'approved' ? 'bg-green-100 text-green-800' :
        status === 'rejected' ? 'bg-red-100 text-red-800' :
          'bg-blue-100 text-blue-800'
    }
    if (type === 'task') {
      return status === 'completed' ? 'bg-green-100 text-green-800' :
        'bg-purple-100 text-purple-800'
    }
    return 'bg-gray-100 text-gray-800'
  }

  const getTimeAgo = (date) => {
    const now = new Date()
    const activityDate = new Date(date)
    const diffMs = now - activityDate
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 60) return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`
  }

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
                ID: {employeeData?.employeeCode || user?.employeeCode || user?.employeeId?.employeeCode || user?.employeeNumber || '---'}
              </p>
              <h2 className="text-lg sm:text-xl md:text-2xl font-bold uppercase tracking-wide">
                {employeeData ? `${employeeData.firstName} ${employeeData.lastName}` :
                  (user?.firstName && user?.lastName
                    ? `${user.firstName} ${user.lastName}`
                    : user?.employeeId?.firstName && user?.employeeId?.lastName
                      ? `${user.employeeId.firstName} ${user.employeeId.lastName}`
                      : user?.name || 'User')}
              </h2>
              {(employeeData?.designation || user?.designation || user?.employeeId?.designation) && (
                <p className="text-xs text-gray-300 mt-0.5">
                  {formatDesignation(employeeData?.designation || user?.designation || user?.employeeId?.designation)}
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
                <div className="w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center">
                  <FaSignInAlt className="w-2.5 h-2.5 text-gray-600" />
                </div>
                <p className="text-xs font-medium text-gray-600">Check In Time</p>
              </div>
              <div className="bg-green-100 rounded-lg p-3">
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
                <div className="w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center">
                  <FaSignOutAlt className="w-2.5 h-2.5 text-gray-600" />
                </div>
                <p className="text-xs font-medium text-gray-600">Check Out Time</p>
              </div>
              <div className="bg-red-100 rounded-lg p-3">
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
                <div className="w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center">
                  <FaClock className="w-2.5 h-2.5 text-gray-600" />
                </div>
                <p className="text-xs font-medium text-gray-600">Work Hours</p>
              </div>
              <div className="bg-yellow-100 rounded-lg p-3">
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
                <div className="w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center">
                  <FaCheckCircle className="w-2.5 h-2.5 text-gray-600" />
                </div>
                <p className="text-xs font-medium text-gray-600">Work Status</p>
              </div>
              <div className={`rounded-lg p-3 ${todayAttendance?.status === 'present' ? 'bg-green-100' :
                todayAttendance?.status === 'half-day' ? 'bg-yellow-100' :
                  todayAttendance?.status === 'in-progress' ? 'bg-blue-100' :
                    todayAttendance?.workFromHome ? 'bg-purple-100' :
                      todayAttendance?.status === 'on-leave' ? 'bg-orange-100' :
                        'bg-red-100'
                }`}>
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
      id: 'kpi-stats',
      component: (
        <DraggableKPIGrid
          stats={managerStatsData}
          userId={user?._id || 'manager'}
          showTrend={true}
        />
      )
    },
    {
      id: 'charts',
      component: (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-8">
          {/* Team Attendance */}
          <div style={{ backgroundColor: 'var(--color-bg-card)' }} className="rounded-lg overflow-hidden">
            <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-2">
              <h3 className="text-sm sm:text-base font-bold text-gray-800">Team Attendance This Week</h3>
            </div>
            <div className="h-80 sm:h-80 pr-4 sm:pr-6 pb-4 sm:pb-6">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={teamAttendanceData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" />
                  <XAxis dataKey="name" fontSize={9} tick={{ fontSize: 9, fill: '#6b7280' }} stroke="#9ca3af" />
                  <YAxis fontSize={9} tick={{ fontSize: 9, fill: '#6b7280' }} stroke="#9ca3af" width={35} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="present" fill="#10b981" name="Present" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="absent" fill="#ef4444" name="Absent" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Team Performance Trend */}
          <div style={{ backgroundColor: 'var(--color-bg-card)' }} className="rounded-lg overflow-hidden">
            <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-2">
              <h3 className="text-sm sm:text-base font-bold text-gray-800">Team Performance Trend</h3>
            </div>
            <div className="h-80 sm:h-80 pr-4 sm:pr-6 pb-4 sm:pb-6">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={performanceData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" />
                  <XAxis dataKey="month" fontSize={9} tick={{ fontSize: 9, fill: '#6b7280' }} stroke="#9ca3af" />
                  <YAxis fontSize={9} tick={{ fontSize: 9, fill: '#6b7280' }} stroke="#9ca3af" width={35} />
                  <Tooltip
                    content={<CustomTooltip valueFormatter={(value) => `${value}%`} />}
                  />
                  <Line type="monotone" dataKey="performance" stroke="#8b5cf6" strokeWidth={2} name="Team Performance %" dot={{ r: 4, fill: '#8b5cf6', strokeWidth: 2, stroke: '#ffffff' }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'team-activities-actions',
      component: (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Team Activities */}
          <div className="rounded-lg shadow-md p-6" style={{ backgroundColor: 'var(--color-bg-card)' }}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Team Activities</h3>
            <div className="space-y-4">
              {recentActivities.length > 0 ? (
                recentActivities.slice(0, 5).map((activity, index) => (
                  <div key={index} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                    <div className="flex items-center space-x-3">
                      <div className={`w-2 h-2 rounded-full ${getActivityColor(activity.type, activity.status).split(' ')[0]}`}></div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{activity.message}</p>
                        <p className="text-xs text-gray-500 capitalize">{activity.status}</p>
                      </div>
                    </div>
                    <span className="text-xs text-gray-400">{getTimeAgo(activity.date)}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">No recent activities</p>
              )}
            </div>
          </div>

          {/* Manager Quick Actions */}
          <div className="rounded-lg shadow-md p-6" style={{ backgroundColor: 'var(--color-bg-card)' }}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Manager Quick Actions</h3>
            <div className="grid grid-cols-2 gap-4">
              {[
                { name: 'Review Leaves', icon: FaCalendarAlt, href: '/dashboard/leave/approvals' },
                { name: 'Team Performance', icon: FaChartLine, href: '/dashboard/performance/reviews' },
                { name: 'Create Review', icon: FaAward, href: '/dashboard/performance/create' },
                { name: 'Mark Attendance', icon: FaClock, href: '/dashboard/attendance' },
              ].map((action, index) => (
                <a
                  key={index}
                  href={action.href}
                  className="flex flex-col items-center justify-center p-6 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                >
                  <div className="p-3 rounded-lg mb-3" style={{ backgroundColor: primaryColor }}>
                    <action.icon className="w-6 h-6 text-white" />
                  </div>
                  <span className="text-sm font-medium text-gray-900 text-center">{action.name}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'team-members-leaves',
      component: (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Team Members */}
          <div className="rounded-lg shadow-md p-6" style={{ backgroundColor: 'var(--color-bg-card)' }}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Team Members</h3>
            <div className="space-y-3">
              {teamMembers.length > 0 ? (
                teamMembers.map((member, index) => {
                  const isOnLeave = stats.onLeaveToday.some(leave =>
                    leave.employee._id === member._id
                  )
                  const isAbsent = stats.absentToday.some(absent =>
                    absent.employee._id === member._id
                  )
                  const isPresent = stats.presentToday?.some(present =>
                    present.employee._id === member._id
                  )
                  const isInProgress = stats.inProgressToday?.some(inProgress =>
                    inProgress.employee._id === member._id
                  )
                  const isLate = stats.lateToday?.some(late =>
                    late.employee._id === member._id
                  )

                  // Determine status based on actual attendance records
                  let status = 'Not Checked In'
                  if (isOnLeave) {
                    status = 'On Leave'
                  } else if (isAbsent) {
                    status = 'Absent'
                  } else if (isLate) {
                    status = 'Late'
                  } else if (isInProgress) {
                    status = 'In Progress'
                  } else if (isPresent) {
                    status = 'Present'
                  }

                  const initials = `${member.firstName[0]}${member.lastName[0]}`

                  return (
                    <div key={index} className="flex items-center justify-between py-2">
                      <div className="flex items-center space-x-3">
                        {member.profilePicture ? (
                          <img
                            src={member.profilePicture}
                            alt={`${member.firstName} ${member.lastName}`}
                            className="w-10 h-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm" style={{ backgroundColor: primaryColor }}>
                            {initials}
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium text-gray-900">{member.firstName} {member.lastName}</p>
                          <p className="text-xs text-gray-500">
                            {formatDesignation(member.designation) || 'Employee'}
                          </p>
                        </div>
                      </div>
                      <span className={`px-2 py-1 text-xs rounded-full ${status === 'Present' ? 'bg-green-100 text-green-800' :
                        status === 'In Progress' ? 'bg-orange-100 text-orange-800' :
                          status === 'Late' ? 'bg-yellow-100 text-yellow-800' :
                            status === 'On Leave' ? 'bg-blue-100 text-blue-800' :
                              status === 'Absent' ? 'bg-red-100 text-red-800' :
                                'bg-gray-100 text-gray-600'
                        }`}>
                        {status}
                      </span>
                    </div>
                  )
                })
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">No team members found</p>
              )}
            </div>
          </div>

          {/* Pending Leave Approvals */}
          <div className="rounded-lg shadow-md p-6" style={{ backgroundColor: 'var(--color-bg-card)' }}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Pending Leave Approvals</h3>
            <div className="space-y-4">
              {pendingLeaves.length > 0 ? (
                pendingLeaves.map((leave, index) => {
                  const startDate = new Date(leave.startDate).toLocaleDateString()
                  const endDate = new Date(leave.endDate).toLocaleDateString()
                  const days = Math.ceil((new Date(leave.endDate) - new Date(leave.startDate)) / (1000 * 60 * 60 * 24)) + 1

                  return (
                    <div key={index} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-gray-900">
                          {leave.employee.firstName} {leave.employee.lastName}
                        </h4>
                        <span className="text-xs text-gray-500">{days} day{days !== 1 ? 's' : ''}</span>
                      </div>
                      <p className="text-xs text-gray-600 mb-3">
                        {leave.leaveType?.name || 'Leave'} • {startDate} - {endDate}
                      </p>
                      {leave.reason && (
                        <p className="text-xs text-gray-500 mb-3 italic">"{leave.reason}"</p>
                      )}
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleApproveLeave(leave._id)}
                          className="px-3 py-1 text-white text-xs rounded transition-colors"
                          style={{ backgroundColor: primaryColor }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = primaryDark}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = primaryColor}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleRejectLeave(leave._id)}
                          className="px-3 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )
                })
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">No pending leave approvals</p>
              )}
            </div>
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
        userId={user?._id || 'manager'}
        storageKey="manager-dashboard"
      />
    </div>
  )
}
