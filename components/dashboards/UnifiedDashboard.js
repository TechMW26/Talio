'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { useTheme } from '@/contexts/ThemeContext'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import { CustomizableDashboard } from '@/components/dashboard'
import CallAlertButton from '@/components/CallAlertButton'
import useRealtimeDashboard from '@/hooks/useRealtimeDashboard'
import {
    FaUsers, FaCalendarAlt, FaUserPlus,
    FaBriefcase, FaFileAlt, FaUserClock, FaUserTimes,
    FaExclamationCircle, FaChartLine, FaTasks, FaClipboardCheck
} from 'react-icons/fa'
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
    HolidaysWidget,
    GoalsWidget,
    BirthdayWidget,
    RecentActivitiesWidget,
    TodayTasksWidget,
    MyAssetsWidget,
    MyExpensesWidget,
    MyHelpdeskWidget,
    PoliciesWidget
} from '@/components/widgets'

/**
 * Role-based Permission Matrix
 * Defines which widgets are visible for each role
 */
const ROLE_PERMISSIONS = {
    // Admin and Department Head have full access
    admin: {
        // Common widgets
        checkInOut: true,
        quickGlance: true,
        attendanceSummary: true,
        leaveBalance: true,
        announcements: true,
        holidays: true,
        projectTasks: true,
        quickActions: true,
        myAssets: true,
        myExpenses: true,
        myHelpdesk: true,
        policies: true,
        // Management widgets
        kpiStats: true,
        leaveRequests: true,
        teamAttendance: true,
        departmentChart: true,
        employeeDirectory: true,
        // Employee-specific widgets (admin can optionally see their own)
        goals: true,
        birthday: true,
        recentActivities: true,
        todayTasks: true,
    },
    department_head: {
        checkInOut: true,
        quickGlance: true,
        attendanceSummary: true,
        leaveBalance: true,
        announcements: true,
        holidays: true,
        projectTasks: true,
        quickActions: true,
        myAssets: true,
        myExpenses: true,
        myHelpdesk: true,
        policies: true,
        kpiStats: true,
        leaveRequests: true,
        teamAttendance: true,
        departmentChart: true,
        employeeDirectory: true,
        goals: true,
        birthday: true,
        recentActivities: true,
        todayTasks: true,
    },
    hr: {
        checkInOut: true,
        quickGlance: true,
        attendanceSummary: true,
        leaveBalance: true,
        announcements: true,
        holidays: true,
        projectTasks: true,
        quickActions: true,
        myAssets: false,
        myExpenses: false,
        myHelpdesk: false,
        policies: false,
        kpiStats: true,
        leaveRequests: true,
        teamAttendance: true,
        departmentChart: true,
        employeeDirectory: true,
        goals: false,
        birthday: false,
        recentActivities: false,
        todayTasks: false,
    },
    manager: {
        checkInOut: true,
        quickGlance: true,
        attendanceSummary: true,
        leaveBalance: true,
        announcements: true,
        holidays: true,
        projectTasks: true,
        quickActions: true,
        myAssets: true,
        myExpenses: true,
        myHelpdesk: true,
        policies: true,
        kpiStats: true,
        leaveRequests: true,
        teamAttendance: true,
        departmentChart: false,
        employeeDirectory: false,
        goals: false,
        birthday: false,
        recentActivities: false,
        todayTasks: false,
    },
    employee: {
        checkInOut: true,
        quickGlance: true,
        attendanceSummary: true,
        leaveBalance: true,
        announcements: true,
        holidays: true,
        projectTasks: true,
        quickActions: true,
        myAssets: true,
        myExpenses: true,
        myHelpdesk: true,
        policies: true,
        kpiStats: false,
        leaveRequests: false,
        teamAttendance: false,
        departmentChart: false,
        employeeDirectory: false,
        goals: true,
        birthday: true,
        recentActivities: true,
        todayTasks: true,
    },
}

/**
 * Get permissions for a given role
 * Returns default employee permissions if role is unknown
 */
const getPermissions = (role) => {
    return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.employee
}

/**
 * Check if user has management role (can see team/org data)
 */
const isManagementRole = (role) => {
    return ['admin', 'department_head', 'hr', 'manager'].includes(role)
}

/**
 * Check if user has HR-level access
 */
const isHRLevel = (role) => {
    return ['admin', 'department_head', 'hr'].includes(role)
}

/**
 * Check if user has admin-level access
 */
const isAdminLevel = (role) => {
    return ['admin', 'department_head'].includes(role)
}

/**
 * Unified Dashboard Component
 * A single dashboard that adapts to user's role and permissions
 */
export default function UnifiedDashboard({ user: userProp }) {
    const router = useRouter()
    const { theme } = useTheme()

    // Theme colors
    const primaryColor = theme?.primary?.[500] || '#3B82F6'
    const primaryDark = theme?.primary?.[600] || '#2563EB'

    // State
    const [loading, setLoading] = useState(true)
    const [user, setUser] = useState(userProp)
    const [todayAttendance, setTodayAttendance] = useState(null)
    const [attendanceLoading, setAttendanceLoading] = useState(false)
    const [remainingTime, setRemainingTime] = useState(28800) // 8 hours in seconds
    const [isCountingDown, setIsCountingDown] = useState(false)
    const [companySettings, setCompanySettings] = useState(null)

    // Dashboard data states
    const [dashboardStats, setDashboardStats] = useState(null)
    const [employees, setEmployees] = useState([])
    const [departments, setDepartments] = useState([])
    const [leaveRequests, setLeaveRequests] = useState([])
    const [attendanceData, setAttendanceData] = useState([])

    // Employee data for the logged-in user
    const [employeeData, setEmployeeData] = useState(() => {
        if (userProp?.employeeId && typeof userProp.employeeId === 'object') {
            return userProp.employeeId
        }
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

    // Get employee ID and role
    const employeeIdStr = getEmployeeId(user)
    const userRole = user?.role || 'employee'
    const permissions = useMemo(() => getPermissions(userRole), [userRole])

    // Format countdown time - using useCallback for stable reference
    const formatCountdown = useCallback((seconds) => {
        const hours = Math.floor(seconds / 3600)
        const minutes = Math.floor((seconds % 3600) / 60)
        const secs = seconds % 60
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    }, [])

    // Fetch company settings
    const fetchCompanySettings = useCallback(async () => {
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
    }, [])

    // Fetch dashboard data based on role - MUST be defined before realtime handlers
    const fetchDashboardData = useCallback(async () => {
        try {
            const token = localStorage.getItem('token')
            const role = user?.role || 'employee'

            // Determine which stats endpoint to use based on role
            // Admin and HR share the same stats endpoint
            let statsEndpoint = '/api/dashboard/employee-stats'
            if (isAdminLevel(role) || role === 'hr') {
                statsEndpoint = '/api/dashboard/hr-stats'
            } else if (role === 'manager') {
                statsEndpoint = '/api/dashboard/manager-stats'
            }

            const fetchPromises = [
                fetch(statsEndpoint, { headers: { 'Authorization': `Bearer ${token}` } })
            ]

            // Fetch additional data for management roles
            if (isManagementRole(role)) {
                fetchPromises.push(
                    fetch('/api/employees?limit=1000', { headers: { 'Authorization': `Bearer ${token}` } }),
                    fetch('/api/leave?status=pending&limit=10', { headers: { 'Authorization': `Bearer ${token}` } })
                )
            }

            if (isHRLevel(role)) {
                fetchPromises.push(
                    fetch('/api/departments', { headers: { 'Authorization': `Bearer ${token}` } }),
                    fetch('/api/attendance/summary', { headers: { 'Authorization': `Bearer ${token}` } })
                )
            }

            const responses = await Promise.allSettled(fetchPromises)

            // Process stats response
            if (responses[0].status === 'fulfilled') {
                const statsData = await responses[0].value.json()
                if (statsData.success) {
                    setDashboardStats(statsData.data)
                }
            }

            // Process employees response (for management roles)
            if (responses[1]?.status === 'fulfilled') {
                const empData = await responses[1].value.json()
                if (empData.success) {
                    setEmployees(empData.data || [])
                }
            }

            // Process leave requests response (for management roles)
            if (responses[2]?.status === 'fulfilled') {
                const leaveData = await responses[2].value.json()
                if (leaveData.success) {
                    setLeaveRequests(leaveData.data || [])
                }
            }

            // Process departments response (for HR/Admin roles)
            if (responses[3]?.status === 'fulfilled') {
                const deptData = await responses[3].value.json()
                if (deptData.success) {
                    setDepartments(deptData.data || [])
                }
            }

            // Process attendance summary response (for HR/Admin roles)
            if (responses[4]?.status === 'fulfilled') {
                const attData = await responses[4].value.json()
                if (attData.success) {
                    setAttendanceData(attData.data || [])
                }
            }

        } catch (error) {
            console.error('Fetch dashboard data error:', error)
        }
    }, [user?.role])

    // Fetch today's attendance - MUST be defined before realtime handlers
    const fetchTodayAttendance = useCallback(async () => {
        if (!employeeIdStr) return
        try {
            setAttendanceLoading(true)
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
        } finally {
            setAttendanceLoading(false)
        }
    }, [employeeIdStr])

    // Fetch employee data
    const fetchEmployeeData = useCallback(async () => {
        if (!employeeIdStr) return
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
    }, [employeeIdStr])

    // Real-time update handlers - MUST come after fetch functions
    const handleRealtimeUpdate = useCallback((data) => {
        console.log('🔄 [Unified Dashboard] Real-time update received')
        fetchDashboardData()
    }, [fetchDashboardData])

    const handleAttendanceUpdate = useCallback((data) => {
        console.log('🔄 [Unified Dashboard] Attendance update received')
        if (employeeIdStr) {
            fetchTodayAttendance()
        }
        if (isManagementRole(userRole)) {
            fetchDashboardData()
        }
    }, [employeeIdStr, userRole, fetchTodayAttendance, fetchDashboardData])

    // Subscribe to real-time updates
    const { isConnected } = useRealtimeDashboard({
        onAttendanceUpdate: handleAttendanceUpdate,
        onLeaveUpdate: handleRealtimeUpdate,
        onExpenseUpdate: handleRealtimeUpdate,
        onProjectUpdate: handleRealtimeUpdate,
        onTaskUpdate: handleRealtimeUpdate,
        onEmployeeUpdate: handleRealtimeUpdate,
        onAnnouncementUpdate: handleRealtimeUpdate,
        onHolidayUpdate: handleRealtimeUpdate,
        onDashboardRefresh: handleRealtimeUpdate
    })

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

    // Initial data load
    useEffect(() => {
        const loadAllData = async () => {
            const promises = [fetchDashboardData(), fetchCompanySettings()]

            if (employeeIdStr) {
                promises.push(fetchTodayAttendance())
                promises.push(fetchEmployeeData())
            }

            await Promise.allSettled(promises)
            setLoading(false)
        }

        loadAllData()
    }, [user, employeeIdStr, fetchDashboardData, fetchTodayAttendance, fetchEmployeeData, fetchCompanySettings])

    // Countdown timer effect
    useEffect(() => {
        if (todayAttendance?.checkIn && !todayAttendance?.checkOut) {
            const checkInTime = new Date(todayAttendance.checkIn).getTime()
            const now = Date.now()
            const elapsedSeconds = Math.floor((now - checkInTime) / 1000)
            const remaining = Math.max(0, 28800 - elapsedSeconds)
            setRemainingTime(remaining)
            setIsCountingDown(true)
        } else if (todayAttendance?.checkOut) {
            setIsCountingDown(false)
            setRemainingTime(0)
        } else {
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

    // Handle check-in
    const handleCheckIn = useCallback(async (locationData) => {
        try {
            setAttendanceLoading(true)
            const token = localStorage.getItem('token')

            const payload = {
                employeeId: employeeIdStr,
                ...(locationData && { location: locationData })
            }

            const response = await fetch('/api/attendance/checkin', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            })

            const data = await response.json()
            if (data.success) {
                toast.success('Checked in successfully!')
                setTodayAttendance(data.data)
            } else {
                toast.error(data.message || 'Failed to check in')
            }
        } catch (error) {
            console.error('Check in error:', error)
            toast.error('Failed to check in')
        } finally {
            setAttendanceLoading(false)
        }
    }, [employeeIdStr])

    // Handle check-out
    const handleCheckOut = useCallback(async (locationData) => {
        try {
            setAttendanceLoading(true)
            const token = localStorage.getItem('token')

            const payload = {
                employeeId: employeeIdStr,
                ...(locationData && { location: locationData })
            }

            const response = await fetch('/api/attendance/checkout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            })

            const data = await response.json()
            if (data.success) {
                toast.success('Checked out successfully!')
                setTodayAttendance(data.data)
            } else {
                toast.error(data.message || 'Failed to check out')
            }
        } catch (error) {
            console.error('Check out error:', error)
            toast.error('Failed to check out')
        } finally {
            setAttendanceLoading(false)
        }
    }, [employeeIdStr])

    // Build widget components object based on role permissions
    // CustomizableDashboard expects an object mapping widget IDs to rendered components
    const widgetComponents = useMemo(() => {
        const components = {}

        // === COMMON WIDGETS (All Roles) ===

        // Check In/Out Widget - Primary widget for all users
        if (permissions.checkInOut) {
            components['check-in-out'] = (
                <CheckInOutWidget
                    user={user}
                    employeeData={employeeData}
                    todayAttendance={todayAttendance}
                    attendanceLoading={attendanceLoading}
                    onClockIn={handleCheckIn}
                    onClockOut={handleCheckOut}
                />
            )
        }

        // Quick Glance Widget
        if (permissions.quickGlance) {
            components['quick-glance'] = (
                <QuickGlanceWidget
                    todayAttendance={todayAttendance}
                    remainingTime={remainingTime}
                    isCountingDown={isCountingDown}
                    formatCountdown={formatCountdown}
                    companySettings={companySettings}
                />
            )
        }

        // === MANAGEMENT WIDGETS (Admin, HR, Manager, Dept Head) ===

        // KPI Stats Widget - Transform stats object to array format
        if (permissions.kpiStats) {
            // Build stats array from dashboardStats object
            const statsArray = []
            if (dashboardStats) {
                // HR/Admin stats format
                if (dashboardStats.totalEmployees) {
                    statsArray.push({
                        title: 'Total Employees',
                        value: dashboardStats.totalEmployees?.value?.toString() || '0',
                        icon: FaUsers,
                        href: '/dashboard/employees'
                    })
                }
                if (dashboardStats.activeToday) {
                    statsArray.push({
                        title: 'Active Today',
                        value: `${dashboardStats.activeToday?.value || 0}/${dashboardStats.activeToday?.total || 0}`,
                        icon: FaUserClock,
                        href: '/dashboard/attendance'
                    })
                }
                if (dashboardStats.onLeaveToday) {
                    statsArray.push({
                        title: 'On Leave',
                        value: dashboardStats.onLeaveToday?.value?.toString() || '0',
                        icon: FaCalendarAlt,
                        href: '/dashboard/leave'
                    })
                }
                if (dashboardStats.lateToday) {
                    statsArray.push({
                        title: 'Late Today',
                        value: dashboardStats.lateToday?.value?.toString() || '0',
                        icon: FaUserTimes,
                        href: '/dashboard/attendance'
                    })
                }
                if (dashboardStats.pendingApprovals) {
                    statsArray.push({
                        title: 'Pending Approvals',
                        value: dashboardStats.pendingApprovals?.leaves?.toString() || '0',
                        icon: FaExclamationCircle,
                        href: '/dashboard/leave/approvals'
                    })
                }
                if (dashboardStats.openPositions) {
                    statsArray.push({
                        title: 'Open Positions',
                        value: dashboardStats.openPositions?.value?.toString() || '0',
                        icon: FaBriefcase,
                        href: '/dashboard/recruitment'
                    })
                }
                // Manager stats format
                if (dashboardStats.teamSize !== undefined) {
                    statsArray.push({
                        title: 'Team Size',
                        value: dashboardStats.teamSize?.toString() || '0',
                        icon: FaUsers,
                        href: '/dashboard/employees'
                    })
                }
                if (dashboardStats.presentToday !== undefined) {
                    statsArray.push({
                        title: 'Present Today',
                        value: dashboardStats.presentToday?.toString() || '0',
                        icon: FaUserClock,
                        href: '/dashboard/attendance'
                    })
                }
                if (dashboardStats.pendingTasks !== undefined) {
                    statsArray.push({
                        title: 'Pending Tasks',
                        value: dashboardStats.pendingTasks?.toString() || '0',
                        icon: FaTasks,
                        href: '/dashboard/projects'
                    })
                }
                if (dashboardStats.completedTasks !== undefined) {
                    statsArray.push({
                        title: 'Completed Tasks',
                        value: dashboardStats.completedTasks?.toString() || '0',
                        icon: FaClipboardCheck,
                        href: '/dashboard/projects'
                    })
                }
            }

            components['kpi-stats'] = (
                <KPIStatsWidget
                    statsData={statsArray}
                />
            )
        }

        // Leave Requests Widget (for approvers)
        if (permissions.leaveRequests) {
            components['leave-requests'] = (
                <LeaveRequestsWidget
                    leaveRequests={leaveRequests}
                />
            )
        }

        // Team Attendance Widget
        if (permissions.teamAttendance) {
            components['team-attendance'] = <TeamAttendanceWidget />
        }

        // === HR/ADMIN WIDGETS ===

        // Department Chart Widget
        if (permissions.departmentChart) {
            components['department-distribution'] = (
                <DepartmentChartWidget
                    departmentStats={departments.map(dept => ({
                        name: dept.name,
                        value: employees.filter(emp => emp.department?._id === dept._id || emp.department === dept._id).length
                    }))}
                />
            )
        }

        // Employee Directory Widget
        if (permissions.employeeDirectory) {
            components['employee-directory'] = <EmployeeDirectoryWidget />
        }

        // === EMPLOYEE-FOCUSED WIDGETS ===

        // Attendance Summary Widget
        if (permissions.attendanceSummary) {
            components['attendance-summary'] = (
                <AttendanceSummaryWidget
                    employeeId={employeeIdStr}
                />
            )
        }

        // Leave Balance Widget
        if (permissions.leaveBalance) {
            components['leave-balance'] = (
                <LeaveBalanceWidget
                    employeeId={employeeIdStr}
                />
            )
        }

        // Goals Widget (Employee-focused)
        if (permissions.goals) {
            components['goals'] = <GoalsWidget userId={user?.userId || user?._id} />
        }

        // Today's Tasks Widget
        if (permissions.todayTasks) {
            components['today-tasks'] = <TodayTasksWidget limit={5} />
        }

        // Project Tasks Widget
        if (permissions.projectTasks) {
            components['project-tasks'] = <ProjectTasksWidgetWrapper limit={5} />
        }

        // === INFORMATIONAL WIDGETS ===

        // Announcements Widget
        if (permissions.announcements) {
            components['announcements'] = <AnnouncementsWidget />
        }

        // Holidays Widget
        if (permissions.holidays) {
            components['holidays'] = <HolidaysWidget />
        }

        // Birthday Widget
        if (permissions.birthday) {
            components['birthdays'] = <BirthdayWidget />
        }

        // === PERSONAL WIDGETS ===

        // My Assets Widget
        if (permissions.myAssets) {
            components['my-assets'] = <MyAssetsWidget user={user} />
        }

        // My Expenses Widget
        if (permissions.myExpenses) {
            components['my-expenses'] = <MyExpensesWidget user={user} />
        }

        // My Helpdesk Widget
        if (permissions.myHelpdesk) {
            components['my-helpdesk'] = <MyHelpdeskWidget user={user} />
        }

        // Policies Widget
        if (permissions.policies) {
            components['policies'] = <PoliciesWidget />
        }

        // Quick Actions Widget
        if (permissions.quickActions) {
            components['quick-actions'] = <QuickActionsWidget />
        }

        // Recent Activities Widget
        if (permissions.recentActivities) {
            components['recent-activities'] = <RecentActivitiesWidget />
        }

        return components
    }, [
        permissions,
        user,
        userRole,
        employeeIdStr,
        employeeData,
        todayAttendance,
        attendanceLoading,
        dashboardStats,
        employees,
        departments,
        leaveRequests,
        attendanceData,
        remainingTime,
        isCountingDown,
        companySettings,
        router,
        handleCheckIn,
        handleCheckOut,
        formatCountdown,
        fetchDashboardData
    ])

    // Role display names
    const roleDisplayName = useMemo(() => {
        const roleNames = {
            admin: 'Administrator',
            department_head: 'Department Head',
            hr: 'HR Manager',
            manager: 'Manager',
            employee: 'Employee'
        }
        return roleNames[userRole] || 'User'
    }, [userRole])

    // Loading skeleton
    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
                <div className="animate-pulse space-y-4">
                    <div className="h-16 bg-white rounded-xl shadow-sm"></div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className="h-24 bg-white rounded-xl shadow-sm"></div>
                        ))}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[1, 2, 3, 4, 5, 6].map(i => (
                            <div key={i} className="h-48 bg-white rounded-xl shadow-sm"></div>
                        ))}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="page-container">
            {/* Call Alert Button - Fixed position for easy access (management roles only) */}
            {isManagementRole(userRole) && (
                <div className="fixed bottom-6 right-6 z-40">
                    <CallAlertButton user={user} />
                </div>
            )}

            {/* Dashboard Content */}
            <CustomizableDashboard
                userId={user?._id || user?.userId || 'user'}
                userRole={userRole}
                widgetComponents={widgetComponents}
            />
        </div>
    )
}

// Export role permission helpers for use in other components
export { getPermissions, isManagementRole, isHRLevel, isAdminLevel, ROLE_PERMISSIONS }
