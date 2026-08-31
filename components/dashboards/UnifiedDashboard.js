'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { useTheme } from '@/contexts/ThemeContext'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import { getRoleDisplayLabel } from '@/hooks/useRoles'
import { useCompanyFeatures } from '@/contexts/CompanyFeaturesContext'
import { CustomizableDashboard } from '@/components/dashboard'
import CallAlertButton from '@/components/CallAlertButton'
import useRealtimeDashboard from '@/hooks/useRealtimeDashboard'
import { getTodayDateString } from '@/lib/timezone'
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
    PoliciesWidget,
    RoleNewsWidget
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
        roleNews: true,
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
        roleNews: true,
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
        roleNews: true,
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
        roleNews: true,
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
        roleNews: true,
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

async function syncDesktopAttendanceCapture(action) {
    if (typeof window === 'undefined') return

    const desktopAPI = window.talioDesktop || window.electronAPI
    if (!desktopAPI) return

    try {
        if (action === 'clock-in') {
            if (typeof desktopAPI.attendanceClockIn === 'function') {
                await desktopAPI.attendanceClockIn()
            } else if (typeof desktopAPI.startCapture === 'function') {
                await desktopAPI.startCapture()
            }
            return
        }

        if (typeof desktopAPI.attendanceClockOut === 'function') {
            await desktopAPI.attendanceClockOut()
        } else if (typeof desktopAPI.stopCapture === 'function') {
            await desktopAPI.stopCapture()
        }
    } catch (error) {
        console.warn('[Dashboard] Desktop attendance capture sync failed:', error)
    }
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
    const [departments, setDepartments] = useState([])
    const [leaveRequests, setLeaveRequests] = useState([])
    const [attendanceData, setAttendanceData] = useState([])

    // Unified widget data (fetched in single API call for performance)
    const [unifiedWidgetData, setUnifiedWidgetData] = useState(null)

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

    // Ref to avoid re-creating fetchUnifiedWidgetData when employeeData changes
    const employeeDataRef = useRef(employeeData)
    employeeDataRef.current = employeeData

    // Version counter to prevent stale fetchUnifiedWidgetData responses from
    // overwriting attendance state set directly by check-in/check-out/socket handlers.
    // Incremented on every direct setTodayAttendance call; fetchUnifiedWidgetData
    // captures it before fetching and skips the update if it changed during the request.
    const attendanceVersionRef = useRef(0)

    // Get employee ID and role
    const employeeIdStr = getEmployeeId(user)
    const userRole = user?.role || 'employee'
    const permissions = useMemo(() => getPermissions(userRole), [userRole])
    const { isFeatureEnabled } = useCompanyFeatures()
    const featurePermissions = useMemo(() => ({
        ...permissions,
        checkInOut: permissions.checkInOut && isFeatureEnabled('gpsAttendance'),
        quickGlance: permissions.quickGlance && isFeatureEnabled('gpsAttendance'),
        attendanceSummary: permissions.attendanceSummary && isFeatureEnabled('gpsAttendance'),
        teamAttendance: permissions.teamAttendance && isFeatureEnabled('gpsAttendance'),
        leaveRequests: permissions.leaveRequests && isFeatureEnabled('leaveManagement'),
        leaveBalance: permissions.leaveBalance && isFeatureEnabled('leaveManagement'),
        projectTasks: permissions.projectTasks && isFeatureEnabled('projects'),
        todayTasks: permissions.todayTasks && isFeatureEnabled('projects'),
        departmentChart: permissions.departmentChart && isFeatureEnabled('employees'),
        employeeDirectory: permissions.employeeDirectory && isFeatureEnabled('employees'),
        goals: permissions.goals && isFeatureEnabled('performance'),
        birthday: permissions.birthday && isFeatureEnabled('employees'),
        announcements: permissions.announcements && isFeatureEnabled('announcements'),
        holidays: permissions.holidays && isFeatureEnabled('holidays'),
        myAssets: permissions.myAssets && isFeatureEnabled('assets'),
        myExpenses: permissions.myExpenses && isFeatureEnabled('expenses'),
        myHelpdesk: permissions.myHelpdesk && isFeatureEnabled('helpdesk'),
        policies: permissions.policies && isFeatureEnabled('policies'),
        recentActivities: permissions.recentActivities && isFeatureEnabled('gpsAttendance'),
    }), [permissions, isFeatureEnabled])

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

    // Fetch dashboard stats based on role - ONLY fetches KPI stats
    // Other data (departments, leave requests, attendance) comes from the unified endpoint
    const fetchDashboardData = useCallback(async () => {
        try {
            const token = localStorage.getItem('token')
            const role = user?.role || 'employee'

            // Determine which stats endpoint to use based on role
            let statsEndpoint = '/api/dashboard/employee-stats'
            if (isAdminLevel(role) || role === 'hr') {
                statsEndpoint = '/api/dashboard/hr-stats'
            } else if (role === 'manager') {
                statsEndpoint = '/api/dashboard/manager-stats'
            }

            // Only fetch the stats endpoint - departments, leave requests,
            // attendance summary, and employee data all come from the unified endpoint
            const response = await fetch(statsEndpoint, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            const statsData = await response.json()
            if (statsData.success) {
                setDashboardStats(statsData.data)
            }
        } catch (error) {
            console.error('Fetch dashboard stats error:', error)
        }
    }, [user?.role])

    // Fetch today's attendance - used for real-time updates only (initial load uses unified endpoint)
    const fetchTodayAttendance = useCallback(async () => {
        if (!employeeIdStr) return
        try {
            setAttendanceLoading(true)
            const token = localStorage.getItem('token')
            const today = getTodayDateString()

            const response = await fetch(`/api/attendance?employeeId=${employeeIdStr}&date=${today}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })

            const data = await response.json()
            if (data.success && data.data.length > 0) {
                attendanceVersionRef.current++
                setTodayAttendance(data.data[0])
            }
        } catch (error) {
            console.error('Fetch today attendance error:', error)
        } finally {
            setAttendanceLoading(false)
        }
    }, [employeeIdStr])

    // Fetch unified widget data - single API call for holidays, announcements, assets, expenses, helpdesk, policies
    // ALSO populates: departments, leave requests, attendance summary, employee data, and today's attendance
    // This eliminates 5+ separate API calls that were causing browser connection queue stalling
    const fetchUnifiedWidgetData = useCallback(async () => {
        const versionBeforeFetch = attendanceVersionRef.current
        try {
            const token = localStorage.getItem('token')
            const response = await fetch('/api/dashboard/unified', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            const data = await response.json()
            if (data.success) {
                setUnifiedWidgetData(data)

                // Populate departments from unified response (eliminates /api/departments call)
                if (data.departments) {
                    setDepartments(data.departments)
                }

                // Populate leave requests from unified response (eliminates /api/leave?status=pending call)
                if (data.pendingLeaveRequests) {
                    setLeaveRequests(data.pendingLeaveRequests)
                }

                // Populate attendance summary from unified response (eliminates /api/attendance/summary call)
                if (data.attendanceSummary) {
                    setAttendanceData(data.attendanceSummary)
                }

                // Populate employee data from unified response (eliminates /api/employees/:id call)
                // Use ref to avoid dependency cycle: employeeData change → callback recreated → useEffect re-fires
                if (data.employee && !employeeDataRef.current) {
                    setEmployeeData(data.employee)
                }

                // Populate today's attendance from unified response (eliminates /api/attendance?employeeId=... call)
                // Only apply if no direct attendance update (check-in/check-out/socket) happened during this fetch
                if (data.todayAttendance !== undefined && attendanceVersionRef.current === versionBeforeFetch) {
                    setTodayAttendance(data.todayAttendance)
                }

                // Populate company settings from unified response (eliminates /api/settings/company call)
                if (data.companySettings) {
                    setCompanySettings(data.companySettings)
                }
            }
        } catch (error) {
            console.error('Error fetching unified widget data:', error)
        }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Real-time update handlers - MUST come after fetch functions
    const handleRealtimeUpdate = useCallback((data) => {
        console.log('🔄 [Unified Dashboard] Real-time update received')
        fetchDashboardData()
        fetchUnifiedWidgetData()
    }, [fetchDashboardData, fetchUnifiedWidgetData])

    const handleAttendanceUpdate = useCallback((data) => {
        console.log('🔄 [Unified Dashboard] Attendance update received', data)
        // If the socket event carries the full attendance object, apply it directly
        if (data?.attendance) {
            attendanceVersionRef.current++
            setTodayAttendance(data.attendance)
        } else if (employeeIdStr) {
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

    // Cross-tab sync via BroadcastChannel — updates all open tabs when attendance changes
    const broadcastChannelRef = useRef(null)
    useEffect(() => {
        if (typeof BroadcastChannel === 'undefined') return
        const channel = new BroadcastChannel('talio-attendance-sync')
        broadcastChannelRef.current = channel
        channel.onmessage = (event) => {
            const { type, attendance } = event.data || {}
            if ((type === 'check-in' || type === 'check-out') && attendance) {
                console.log(`📡 [CrossTab] Received ${type} from another tab`)
                attendanceVersionRef.current++
                setTodayAttendance(attendance)
                if (isManagementRole(userRole)) {
                    fetchDashboardData()
                }
            }
        }
        return () => {
            channel.close()
            broadcastChannelRef.current = null
        }
    }, [userRole, fetchDashboardData])

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

    // Initial data load - progressive loading (don't block render)
    // OPTIMIZED: Only 2 API calls instead of 7+
    // - fetchUnifiedWidgetData() → single call that provides: holidays, announcements, assets,
    //   expenses, helpdesk, policies, departments, leave requests, attendance summary,
    //   employee data, today's attendance, and company settings
    // - fetchDashboardData() → KPI stats only (hr-stats/manager-stats/employee-stats)
    // Previously: 7+ calls including separate /api/employees/:id, /api/attendance?employeeId=...,
    //   /api/employees?limit=1000, /api/leave, /api/departments, /api/attendance/summary,
    //   /api/settings/company
    useEffect(() => {
        if (!user || !employeeIdStr) return
        // Show dashboard immediately - widgets will show their own loading states
        setLoading(false)

        // Fetch data in parallel (non-blocking) - only 2 API calls from UnifiedDashboard
        fetchUnifiedWidgetData()  // Single aggregated call (replaces 6+ separate calls, includes company settings)
        fetchDashboardData()       // KPI stats only
    }, [user, employeeIdStr]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const handleCheckIn = useCallback(async () => {
        if (attendanceLoading) return // Prevent double submission
        const previousAttendance = todayAttendance

        // Optimistic UI: show checked-in state immediately
        const optimisticAttendance = {
            ...previousAttendance,
            checkIn: new Date().toISOString(),
            status: 'in-progress',
        }
        attendanceVersionRef.current++
        setTodayAttendance(optimisticAttendance)
        setAttendanceLoading(true)

        try {
            const token = localStorage.getItem('token')

            // Get user's location
            let latitude = null
            let longitude = null
            let accuracy = null
            let locationSource = 'gps'

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
                    accuracy = position.coords.accuracy

                    console.log(`📍 Location captured: ${latitude}, ${longitude} (accuracy: ${accuracy}m)`)
                } catch (geoError) {
                    console.warn('Geolocation error:', geoError)
                }
            }

            // IP-based location fallback if GPS failed
            if (latitude === null || longitude === null) {
                try {
                    console.log('📍 GPS unavailable, attempting IP-based location fallback...')
                    const ipRes = await fetch('/api/attendance/ip-location', {
                        headers: { 'Authorization': `Bearer ${token}` }
                    })
                    const ipData = await ipRes.json()
                    if (ipData.success && ipData.latitude && ipData.longitude) {
                        latitude = ipData.latitude
                        longitude = ipData.longitude
                        accuracy = null // IP location has no meaningful accuracy in meters
                        locationSource = 'ip'
                        console.log(`📍 IP-based location captured: ${latitude}, ${longitude} (${ipData.city}, ${ipData.region})`)
                        toast.info('Using approximate location (IP-based). Enable GPS for precise location.')
                    }
                } catch (ipError) {
                    console.warn('IP location fallback failed:', ipError)
                }
            }

            // Send coordinates to backend - it will handle geocoding with Google Maps
            const response = await fetch('/api/attendance', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    employeeId: employeeIdStr,
                    type: 'clock-in',
                    latitude,
                    longitude,
                    accuracy,
                    locationSource
                })
            })

            const data = await response.json()
            if (data.success) {
                await syncDesktopAttendanceCapture('clock-in')
                toast.success('Checked in successfully!')
                // Replace optimistic data with real server data
                attendanceVersionRef.current++
                setTodayAttendance(data.data)
                // Notify other tabs via BroadcastChannel
                broadcastChannelRef.current?.postMessage({ type: 'check-in', attendance: data.data })
            } else {
                // Rollback optimistic update
                attendanceVersionRef.current++
                setTodayAttendance(previousAttendance)
                toast.error(data.message || 'Failed to check in')
            }
        } catch (error) {
            console.error('Check in error:', error)
            // Rollback optimistic update
            attendanceVersionRef.current++
            setTodayAttendance(previousAttendance)
            toast.error('Failed to check in')
        } finally {
            setAttendanceLoading(false)
        }
    }, [employeeIdStr, attendanceLoading, todayAttendance])

    // Handle check-out
    const handleCheckOut = useCallback(async () => {
        if (attendanceLoading) return // Prevent double submission
        const previousAttendance = todayAttendance

        // Optimistic UI: show checked-out state immediately
        const now = new Date()
        const checkInTime = previousAttendance?.checkIn ? new Date(previousAttendance.checkIn) : now
        const workHours = Math.round(((now - checkInTime) / (1000 * 60 * 60)) * 100) / 100
        const optimisticAttendance = {
            ...previousAttendance,
            checkOut: now.toISOString(),
            status: 'present',
            workHours,
        }
        attendanceVersionRef.current++
        setTodayAttendance(optimisticAttendance)
        setAttendanceLoading(true)

        try {
            const token = localStorage.getItem('token')

            // Get user's location
            let latitude = null
            let longitude = null
            let accuracy = null
            let locationSource = 'gps'

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
                    accuracy = position.coords.accuracy

                    console.log(`📍 Location captured: ${latitude}, ${longitude} (accuracy: ${accuracy}m)`)
                } catch (geoError) {
                    console.warn('Geolocation error:', geoError)
                }
            }

            // IP-based location fallback if GPS failed
            if (latitude === null || longitude === null) {
                try {
                    console.log('📍 GPS unavailable, attempting IP-based location fallback...')
                    const ipRes = await fetch('/api/attendance/ip-location', {
                        headers: { 'Authorization': `Bearer ${token}` }
                    })
                    const ipData = await ipRes.json()
                    if (ipData.success && ipData.latitude && ipData.longitude) {
                        latitude = ipData.latitude
                        longitude = ipData.longitude
                        accuracy = null
                        locationSource = 'ip'
                        console.log(`📍 IP-based location captured: ${latitude}, ${longitude} (${ipData.city}, ${ipData.region})`)
                        toast.info('Using approximate location (IP-based). Enable GPS for precise location.')
                    }
                } catch (ipError) {
                    console.warn('IP location fallback failed:', ipError)
                }
            }

            // Send coordinates to backend - it will handle geocoding with Google Maps
            const response = await fetch('/api/attendance', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    employeeId: employeeIdStr,
                    type: 'clock-out',
                    latitude,
                    longitude,
                    accuracy,
                    locationSource
                })
            })

            const data = await response.json()
            if (data.success) {
                await syncDesktopAttendanceCapture('clock-out')
                toast.success('Checked out successfully!')
                // Replace optimistic data with real server data
                attendanceVersionRef.current++
                setTodayAttendance(data.data)
                // Notify other tabs via BroadcastChannel
                broadcastChannelRef.current?.postMessage({ type: 'check-out', attendance: data.data })
            } else {
                // Rollback optimistic update
                attendanceVersionRef.current++
                setTodayAttendance(previousAttendance)
                toast.error(data.message || 'Failed to check out')
            }
        } catch (error) {
            console.error('Check out error:', error)
            // Rollback optimistic update
            attendanceVersionRef.current++
            setTodayAttendance(previousAttendance)
            toast.error('Failed to check out')
        } finally {
            setAttendanceLoading(false)
        }
    }, [employeeIdStr, attendanceLoading, todayAttendance])

    // Build widget components object based on role permissions
    // CustomizableDashboard expects an object mapping widget IDs to rendered components
    const widgetComponents = useMemo(() => {
        const components = {}

        // === COMMON WIDGETS (All Roles) ===

        // Check In/Out Widget - Primary widget for all users
        if (featurePermissions.checkInOut) {
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
        if (featurePermissions.quickGlance) {
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
                if (dashboardStats.totalEmployees && isFeatureEnabled('employees')) {
                    statsArray.push({
                        title: 'Total Employees',
                        value: dashboardStats.totalEmployees?.value?.toString() || '0',
                        icon: FaUsers,
                        href: '/dashboard/employees'
                    })
                }
                if (dashboardStats.activeToday && isFeatureEnabled('gpsAttendance')) {
                    statsArray.push({
                        title: 'Active Today',
                        value: `${dashboardStats.activeToday?.value || 0}/${dashboardStats.activeToday?.total || 0}`,
                        icon: FaUserClock,
                        href: '/dashboard/attendance'
                    })
                }
                if (dashboardStats.onLeaveToday && isFeatureEnabled('leaveManagement')) {
                    // onLeaveToday can be an array or an object with value
                    const onLeaveCount = Array.isArray(dashboardStats.onLeaveToday)
                        ? dashboardStats.onLeaveToday.length
                        : (dashboardStats.onLeaveToday?.value ?? dashboardStats.onLeaveToday)
                    statsArray.push({
                        title: 'On Leave',
                        value: onLeaveCount?.toString() || '0',
                        icon: FaCalendarAlt,
                        href: '/dashboard/leave'
                    })
                }
                if (dashboardStats.lateToday && isFeatureEnabled('gpsAttendance')) {
                    // lateToday can be an array or an object with value
                    const lateCount = Array.isArray(dashboardStats.lateToday)
                        ? dashboardStats.lateToday.length
                        : (dashboardStats.lateToday?.value ?? dashboardStats.lateToday)
                    statsArray.push({
                        title: 'Late Today',
                        value: lateCount?.toString() || '0',
                        icon: FaUserTimes,
                        href: '/dashboard/attendance'
                    })
                }
                if (dashboardStats.pendingApprovals && isFeatureEnabled('leaveManagement')) {
                    statsArray.push({
                        title: 'Pending Approvals',
                        value: dashboardStats.pendingApprovals?.leaves?.toString() || '0',
                        icon: FaExclamationCircle,
                        href: '/dashboard/leave/approvals'
                    })
                }
                if (dashboardStats.openPositions && isFeatureEnabled('recruitment')) {
                    statsArray.push({
                        title: 'Open Positions',
                        value: dashboardStats.openPositions?.value?.toString() || '0',
                        icon: FaBriefcase,
                        href: '/dashboard/recruitment'
                    })
                }
                // Manager stats format
                if (dashboardStats.teamSize !== undefined && isFeatureEnabled('employees')) {
                    statsArray.push({
                        title: 'Team Size',
                        value: dashboardStats.teamSize?.toString() || '0',
                        icon: FaUsers,
                        href: '/dashboard/employees'
                    })
                }
                if (dashboardStats.presentToday !== undefined && isFeatureEnabled('gpsAttendance')) {
                    // presentToday can be an array or a number
                    const presentCount = Array.isArray(dashboardStats.presentToday)
                        ? dashboardStats.presentToday.length
                        : dashboardStats.presentToday
                    statsArray.push({
                        title: 'Present Today',
                        value: presentCount?.toString() || '0',
                        icon: FaUserClock,
                        href: '/dashboard/attendance'
                    })
                }
                if (dashboardStats.pendingTasks !== undefined && isFeatureEnabled('projects')) {
                    statsArray.push({
                        title: 'Pending Tasks',
                        value: dashboardStats.pendingTasks?.toString() || '0',
                        icon: FaTasks,
                        href: '/dashboard/projects'
                    })
                }
                if (dashboardStats.completedTasks !== undefined && isFeatureEnabled('projects')) {
                    statsArray.push({
                        title: 'Completed Tasks',
                        value: dashboardStats.completedTasks?.toString() || '0',
                        icon: FaClipboardCheck,
                        href: '/dashboard/projects'
                    })
                }
            }

            if (statsArray.length > 0) {
                components['kpi-stats'] = (
                    <KPIStatsWidget
                        statsData={statsArray}
                    />
                )
            }
        }

        // Leave Requests Widget (for approvers)
        if (featurePermissions.leaveRequests) {
            components['leave-requests'] = (
                <LeaveRequestsWidget
                    leaveRequests={leaveRequests}
                />
            )
        }

        // Team Attendance Widget
        if (featurePermissions.teamAttendance) {
            components['team-attendance'] = <TeamAttendanceWidget />
        }

        // === HR/ADMIN WIDGETS ===

        // Department Chart Widget
        // OPTIMIZED: Use pre-aggregated departmentStats from hr-stats endpoint
        // instead of loading all 1000+ employees and filtering client-side
        if (featurePermissions.departmentChart) {
            // Build department stats from hr-stats aggregated data + department names
            const deptStats = departments.map(dept => {
                const statEntry = dashboardStats?.departmentStats?.find(
                    s => s._id === dept._id || s._id?.toString() === dept._id?.toString()
                )
                return {
                    name: dept.name,
                    value: statEntry?.count || 0
                }
            }).filter(d => d.value > 0)

            components['department-distribution'] = (
                <DepartmentChartWidget
                    departmentStats={deptStats}
                />
            )
        }

        // Employee Directory Widget
        if (featurePermissions.employeeDirectory) {
            components['employee-directory'] = <EmployeeDirectoryWidget />
        }

        // === EMPLOYEE-FOCUSED WIDGETS ===

        // Attendance Summary Widget
        if (featurePermissions.attendanceSummary) {
            components['attendance-summary'] = (
                <AttendanceSummaryWidget
                    employeeId={employeeIdStr}
                />
            )
        }

        // Leave Balance Widget (only create when unified data is loaded)
        if (featurePermissions.leaveBalance && unifiedWidgetData) {
            components['leave-balance'] = (
                <LeaveBalanceWidget
                    employeeId={employeeIdStr}
                    initialData={unifiedWidgetData.leaveBalance}
                />
            )
        }

        // Goals Widget (Employee-focused)
        if (featurePermissions.goals) {
            components['goals'] = <GoalsWidget userId={user?.userId || user?._id} />
        }

        // Today's Tasks Widget
        if (featurePermissions.todayTasks) {
            components['today-tasks'] = <TodayTasksWidget limit={5} />
        }

        // Project Tasks Widget
        if (featurePermissions.projectTasks) {
            components['project-tasks'] = <ProjectTasksWidgetWrapper limit={5} />
        }

        // === INFORMATIONAL WIDGETS ===

        // Role News Widget - AI-generated news based on role and designation
        if (permissions.roleNews) {
            components['role-news'] = <RoleNewsWidget />
        }

        // Announcements Widget (only create when unified data is loaded to prevent self-fetch)
        if (featurePermissions.announcements && unifiedWidgetData) {
            components['announcements'] = <AnnouncementsWidget initialData={unifiedWidgetData.announcements} />
        }

        // Holidays Widget
        if (featurePermissions.holidays && unifiedWidgetData) {
            components['holidays'] = <HolidaysWidget initialData={unifiedWidgetData.holidays} />
        }

        // Birthday Widget
        if (featurePermissions.birthday) {
            components['birthdays'] = <BirthdayWidget />
        }

        // === PERSONAL WIDGETS ===

        // My Assets Widget
        if (featurePermissions.myAssets && unifiedWidgetData) {
            components['my-assets'] = <MyAssetsWidget user={user} initialData={unifiedWidgetData.myAssets} />
        }

        // My Expenses Widget
        if (featurePermissions.myExpenses && unifiedWidgetData) {
            components['my-expenses'] = <MyExpensesWidget user={user} initialData={unifiedWidgetData.myExpenses} />
        }

        // My Helpdesk Widget
        if (featurePermissions.myHelpdesk && unifiedWidgetData) {
            components['my-helpdesk'] = <MyHelpdeskWidget user={user} initialData={unifiedWidgetData.myHelpdesk} />
        }

        // Policies Widget
        if (featurePermissions.policies && unifiedWidgetData) {
            components['policies'] = <PoliciesWidget initialData={unifiedWidgetData.policies} />
        }

        // Quick Actions Widget
        if (permissions.quickActions) {
            components['quick-actions'] = <QuickActionsWidget />
        }

        // Recent Activities Widget
        if (featurePermissions.recentActivities) {
            components['recent-activities'] = <RecentActivitiesWidget />
        }

        return components
    }, [
        permissions,
        featurePermissions,
        user,
        userRole,
        employeeIdStr,
        employeeData,
        todayAttendance,
        attendanceLoading,
        dashboardStats,
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
        unifiedWidgetData,
        isFeatureEnabled
    ])

    // Role display names
    const roleDisplayName = useMemo(() => {
        return getRoleDisplayLabel(userRole)
    }, [userRole])

    // Loading skeleton
    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-[#09090b] p-4 sm:p-6">
                <div className="animate-pulse space-y-4">
                    <div className="h-16 bg-white dark:bg-[#18181b] rounded-xl shadow-sm dark:shadow-none"></div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className="h-24 bg-white dark:bg-[#18181b] rounded-xl shadow-sm dark:shadow-none"></div>
                        ))}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[1, 2, 3, 4, 5, 6].map(i => (
                            <div key={i} className="h-48 bg-white dark:bg-[#18181b] rounded-xl shadow-sm dark:shadow-none"></div>
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
                displayName={user?.firstName || employeeData?.firstName || ''}
                widgetComponents={widgetComponents}
            />
        </div>
    )
}

// Export role permission helpers for use in other components
export { getPermissions, isManagementRole, isHRLevel, isAdminLevel, ROLE_PERMISSIONS }
