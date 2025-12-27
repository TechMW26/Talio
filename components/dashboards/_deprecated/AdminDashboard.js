'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import {
  FaUsers, FaClock, FaCalendarAlt, FaMoneyBillWave,
  FaChartLine, FaBriefcase, FaArrowUp, FaArrowDown,
  FaUserPlus, FaBuilding, FaExclamationTriangle, FaEye,
  FaEdit, FaCheck, FaTimes, FaSearch, FaUser,
  FaSignInAlt, FaSignOutAlt, FaCheckCircle
} from 'react-icons/fa'
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { formatDesignation } from '@/lib/formatters'
import { useTheme } from '@/contexts/ThemeContext'
import CustomTooltip, { CustomPieTooltip } from '@/components/charts/CustomTooltip'
import { getEmployeeId } from '@/utils/userHelper'
import ProjectTasksWidget from './ProjectTasksWidget'
import DraggableDashboard from '@/components/dashboard/DraggableDashboard'
import DraggableKPIGrid from '@/components/dashboard/DraggableKPIGrid'
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
  MyAssetsWidget,
  MyExpensesWidget,
  MyHelpdeskWidget,
  PoliciesWidget
} from '@/components/widgets'

export default function AdminDashboard({ user }) {
  const router = useRouter()
  const { theme } = useTheme()

  // Fallback theme colors if theme is not loaded yet
  const primaryColor = theme?.primary?.[500] || '#3B82F6'
  const primaryDark = theme?.primary?.[600] || '#2563EB'

  const [loading, setLoading] = useState(true)
  const [dashboardData, setDashboardData] = useState({
    employees: [],
    departments: [],
    leaveRequests: [],
    attendanceData: [],
    departmentStats: [],
    recentActivities: [],
    pendingApprovals: []
  })
  const [showEmployeeModal, setShowEmployeeModal] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [todayAttendance, setTodayAttendance] = useState(null)
  const [attendanceLoading, setAttendanceLoading] = useState(false)
  const [remainingTime, setRemainingTime] = useState(28800) // 8 hours in seconds (08:00)
  const [isCountingDown, setIsCountingDown] = useState(false)
  const [companySettings, setCompanySettings] = useState(null)
  // Initialize with cached user data for instant display
  const [employeeData, setEmployeeData] = useState(() => {
    if (user?.employeeId && typeof user.employeeId === 'object') return user.employeeId
    if (user?.employeeCode || user?.firstName) {
      return { employeeCode: user.employeeCode, firstName: user.firstName, lastName: user.lastName, designation: user.designation, profilePicture: user.profilePicture }
    }
    return null
  })

  // Get employee ID string for API calls
  const employeeIdStr = getEmployeeId(user)

  // Real-time dashboard updates - automatically refresh data when changes occur
  const handleRealtimeUpdate = useCallback((data) => {
    console.log('🔄 [Admin Dashboard] Real-time update received, refreshing data...')
    // Refresh dashboard data when any update is received
    fetchDashboardData()
  }, [])

  const handleAttendanceUpdate = useCallback((data) => {
    console.log('🔄 [Admin Dashboard] Attendance update received')
    fetchDashboardData()
    if (employeeIdStr) {
      fetchTodayAttendance()
    }
  }, [employeeIdStr])

  const { isConnected } = useRealtimeDashboard({
    onAttendanceUpdate: handleAttendanceUpdate,
    onLeaveUpdate: handleRealtimeUpdate,
    onExpenseUpdate: handleRealtimeUpdate,
    onProjectUpdate: handleRealtimeUpdate,
    onTaskUpdate: handleRealtimeUpdate,
    onEmployeeUpdate: handleRealtimeUpdate,
    onAnnouncementUpdate: handleRealtimeUpdate,
    onDashboardRefresh: handleRealtimeUpdate
  })

  useEffect(() => {
    // Load all data in parallel
    const loadAllData = async () => {
      const promises = [fetchDashboardData(), fetchCompanySettings()]
      if (employeeIdStr) {
        promises.push(fetchTodayAttendance())
        promises.push(fetchEmployeeData())
      }
      await Promise.allSettled(promises)
    }
    loadAllData()
  }, [])

  const fetchCompanySettings = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/settings/company', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setCompanySettings(data.data)
      }
    } catch (error) {
      console.error('Fetch company settings error:', error)
    }
  }

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
      const token = localStorage.getItem('token')

      // Fetch all data in parallel
      const [
        employeesRes,
        departmentsRes,
        leaveRequestsRes,
        attendanceRes
      ] = await Promise.all([
        fetch('/api/employees?limit=1000', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/departments', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/leave', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/attendance/summary', { headers: { 'Authorization': `Bearer ${token}` } })
      ])

      const [employeesData, departmentsData, leaveData, attendanceData] = await Promise.all([
        employeesRes.json(),
        departmentsRes.json(),
        leaveRequestsRes.json(),
        attendanceRes.json()
      ])

      setDashboardData({
        employees: employeesData.success ? employeesData.data : [],
        departments: departmentsData.success ? departmentsData.data : [],
        leaveRequests: leaveData.success ? leaveData.data : [],
        attendanceData: attendanceData.success ? attendanceData.data : [],
        departmentStats: departmentsData.success ? calculateDepartmentStats(departmentsData.data) : [],
        pendingApprovals: leaveData.success ? leaveData.data.filter(req => req.status === 'pending') : []
      })
    } catch (error) {
      console.error('Fetch dashboard data error:', error)
      toast.error('Failed to fetch dashboard data')
    } finally {
      setLoading(false)
    }
  }

  const calculateDepartmentStats = (departments) => {
    const colors = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82ca9d']
    return departments.map((dept, index) => ({
      name: dept.name,
      value: dept.employeeCount || 0,
      color: colors[index % colors.length]
    }))
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
            const updatedUser = { ...currentUser, employeeCode: result.data.employeeCode, firstName: result.data.firstName, lastName: result.data.lastName, designation: result.data.designation, profilePicture: result.data.profilePicture }
            localStorage.setItem('user', JSON.stringify(updatedUser))
          } catch (e) { /* ignore */ }
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
          employeeId: user.employeeId,
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

  const getStatsData = () => {
    // Safety checks to ensure arrays exist
    const employees = Array.isArray(dashboardData.employees) ? dashboardData.employees : []
    const leaveRequests = Array.isArray(dashboardData.leaveRequests) ? dashboardData.leaveRequests : []
    const pendingApprovals = Array.isArray(dashboardData.pendingApprovals) ? dashboardData.pendingApprovals : []
    const departments = Array.isArray(dashboardData.departments) ? dashboardData.departments : []

    const totalEmployees = employees.length
    const activeEmployees = employees.filter(emp => emp.status === 'active').length
    const onLeaveToday = leaveRequests.filter(req => {
      if (req.status !== 'approved') return false
      const today = new Date()
      const startDate = new Date(req.startDate)
      const endDate = new Date(req.endDate)
      return today >= startDate && today <= endDate
    }).length
    const pendingApprovalsCount = pendingApprovals.length
    const totalDepartments = departments.length

    return [
      { title: 'Total Employees', value: totalEmployees, icon: FaUsers, color: 'stat-icon-blue', href: '/dashboard/employees' },
      { title: 'Active Employees', value: activeEmployees, icon: FaClock, color: 'stat-icon-green', href: '/dashboard/employees' },
      { title: 'On Leave Today', value: onLeaveToday, icon: FaCalendarAlt, color: 'stat-icon-yellow', href: '/dashboard/leave/requests' },
      { title: 'Pending Approvals', value: pendingApprovalsCount, icon: FaChartLine, color: 'stat-icon-purple', href: '/dashboard/leave/approvals' },
      { title: 'Departments', value: totalDepartments, icon: FaBuilding, color: 'stat-icon-teal', href: '/dashboard/departments' },
      { title: 'System Health', value: 'Good', icon: FaExclamationTriangle, color: 'bg-green-500', href: '/dashboard/settings' },
    ]
  }
  const handleLeaveAction = async (leaveId, action, reason = '') => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/leave/${leaveId}/action`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          action,
          reason,
          approvedBy: user.employeeId,
        }),
      })

      const data = await response.json()
      if (data.success) {
        toast.success(`Leave request ${action}d successfully`)
        fetchDashboardData() // Refresh data
      } else {
        toast.error(data.message || `Failed to ${action} leave request`)
      }
    } catch (error) {
      console.error(`${action} leave error:`, error)
      toast.error(`Failed to ${action} leave request`)
    }
  }

  const viewEmployeeDetails = (employee) => {
    setSelectedEmployee(employee)
    setShowEmployeeModal(true)
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
        companySettings={companySettings}
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
        leaveRequests={dashboardData.leaveRequests}
        onApprove={(id) => handleLeaveAction(id, 'approve')}
        onReject={(id) => handleLeaveAction(id, 'reject', 'Rejected by admin')}
        onViewAll={() => router.push('/dashboard/leave/approvals')}
      />
    ),
    'department-distribution': (
      <DepartmentChartWidget
        departmentStats={dashboardData.departmentStats}
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
        employees={dashboardData.employees}
        onViewDetails={viewEmployeeDetails}
        onEdit={(employee) => router.push(`/dashboard/employees/edit/${employee._id}`)}
        onViewAll={() => router.push('/dashboard/employees')}
      />
    ),
    'quick-actions': (
      <QuickActionsWidget
        actions={[
          { name: 'Add Employee', icon: 'FaUserPlus', href: '/dashboard/employees/add', color: 'green' },
          { name: 'Manage Departments', icon: 'FaBuilding', href: '/dashboard/departments', color: 'blue' },
          { name: 'Leave Types', icon: 'FaCalendarAlt', href: '/dashboard/leave-types', color: 'purple' },
          { name: 'Leave Allocations', icon: 'FaMoneyBillWave', href: '/dashboard/leave/allocations', color: 'red' },
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
    dashboardData,
    statsData,
    router,
    handleClockIn,
    handleClockOut,
    handleLeaveAction,
    viewEmployeeDetails,
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
      {/* Call Alert Button - Fixed position for easy access */}
      <div className="fixed bottom-6 right-6 z-40">
        <CallAlertButton user={user} />
      </div>

      <CustomizableDashboard
        userId={user?._id || 'admin'}
        userRole={user?.role || 'admin'}
        widgetComponents={widgetComponents}
      />

      {/* Employee Details Modal - kept outside draggable area */}
      {showEmployeeModal && selectedEmployee && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9100]">
          <div className="rounded-lg p-6 w-full max-w-2xl max-h-screen overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-card)' }}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Employee Details</h2>
              <button
                onClick={() => {
                  setShowEmployeeModal(false)
                  setSelectedEmployee(null)
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <FaTimes className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-6">
              {/* Employee Info */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center space-x-4 mb-4">
                  <div className="w-16 h-16 bg-primary-500 rounded-full flex items-center justify-center text-white font-bold text-xl overflow-hidden">
                    {selectedEmployee.profilePicture ? (
                      <img
                        src={selectedEmployee.profilePicture}
                        alt={`${selectedEmployee.firstName} ${selectedEmployee.lastName}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span>{selectedEmployee.firstName?.charAt(0)}{selectedEmployee.lastName?.charAt(0)}</span>
                    )}
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900">
                      {selectedEmployee.firstName} {selectedEmployee.lastName}
                    </h3>
                    <p className="text-gray-600">{selectedEmployee.employeeCode}</p>
                    <p className="text-sm text-gray-500">{selectedEmployee.email}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Department:</span>
                    <span className="ml-2 font-medium">{selectedEmployee.department?.name || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Designation:</span>
                    <span className="ml-2 font-medium">
                      {formatDesignation(selectedEmployee.designation, selectedEmployee)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Status:</span>
                    <span className={`ml-2 px-2 py-1 text-xs rounded-full ${selectedEmployee.status === 'active' ? 'bg-green-100 text-green-800' :
                      'bg-red-100 text-red-800'
                      }`}>
                      {selectedEmployee.status}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Join Date:</span>
                    <span className="ml-2 font-medium">
                      {selectedEmployee.dateOfJoining ? new Date(selectedEmployee.dateOfJoining).toLocaleDateString() : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowEmployeeModal(false)
                    router.push(`/dashboard/employees/${selectedEmployee._id}`)
                  }}
                  className="flex-1 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
                >
                  View Full Profile
                </button>
                <button
                  onClick={() => {
                    setShowEmployeeModal(false)
                    router.push(`/dashboard/employees/edit/${selectedEmployee._id}`)
                  }}
                  className="flex-1 px-4 py-2 text-white rounded-lg transition-colors"
                  style={{ backgroundColor: primaryColor }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = primaryDark}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = primaryColor}
                >
                  Edit Employee
                </button>
                <button
                  onClick={() => {
                    setShowEmployeeModal(false)
                    router.push(`/dashboard/leave/requests?employee=${selectedEmployee._id}`)
                  }}
                  className="flex-1 px-4 py-2 text-white rounded-lg transition-colors"
                  style={{ backgroundColor: primaryColor }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = primaryDark}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = primaryColor}
                >
                  View Leaves
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
