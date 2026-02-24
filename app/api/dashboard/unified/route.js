import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'

export const dynamic = 'force-dynamic'

/**
 * Unified Dashboard API
 * Aggregates all widget data in a single request to reduce network calls
 * This significantly improves mobile performance on slow networks
 */
export async function GET(request) {
  try {
    // Parse query params for which widgets to include
    const { searchParams } = new URL(request.url)
    const includeWidgets = searchParams.get('widgets')?.split(',') || ['all']
    const includeAll = includeWidgets.includes('all')

    // Get authenticated user and tenant-specific models
    // Only load models that are actually queried in this route
    const auth = await getAuthAndModels(request, [
      'Attendance', 'LeaveBalance', 'LeaveType', 'Leave',
      'Employee', 'Department', 'User',
      'Holiday', 'Announcement', 'Asset', 'Expense', 'Ticket', 'Policy',
      'CompanySettings'
    ])

    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }

    const { user, models, tenant } = auth
    const {
      Attendance, LeaveBalance, LeaveType, Leave,
      Employee, Department, User,
      Holiday, Announcement, Asset, Expense, Ticket, Policy,
      CompanySettings
    } = models

    const userRole = user.role || 'employee'
    const isManagement = ['admin', 'department_head', 'hr', 'manager'].includes(userRole)
    const isHRLevel = ['admin', 'department_head', 'hr'].includes(userRole)

    // Get user with employee data (lean for performance)
    const userWithEmployee = await User.findById(user._id || user.userId)
      .populate({
        path: 'employeeId',
        select: 'firstName lastName employeeCode designation department profilePicture status _id',
        populate: [
          { path: 'designation', select: 'title' },
          { path: 'department', select: 'name' }
        ]
      })
      .lean()

    const employee = userWithEmployee?.employeeId
    const employeeId = employee?._id

    // Build cache key
    const todayKey = new Date().toISOString().slice(0, 10)
    const cacheKey = buildCacheKey({
      tenantId: tenant?.databaseName,
      role: userRole,
      userId: user._id || user.userId,
      namespace: 'dashboard:unified',
      params: { date: todayKey, widgets: includeWidgets.join(',') }
    })

    // Check cache first
    const cached = await getCache(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Initialize response object
    const dashboardData = {
      success: true,
      timestamp: new Date().toISOString(),
      user: {
        _id: user._id || user.userId,
        role: userRole,
        email: user.email
      }
    }

    // Fetch all data in parallel for better performance
    const fetchPromises = []

    // === EMPLOYEE DATA ===
    if (employee) {
      dashboardData.employee = {
        _id: employee._id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        employeeCode: employee.employeeCode,
        designation: employee.designation,
        department: employee.department,
        profilePicture: employee.profilePicture,
        status: employee.status
      }
    }

    // === HOLIDAYS (for all roles) ===
    // === COMPANY SETTINGS (for CheckInOutWidget work hours config) ===
    fetchPromises.push(
      CompanySettings.findOne().lean()
        .then(settings => {
          dashboardData.companySettings = settings || null
        })
        .catch(() => { dashboardData.companySettings = null })
    )

    if (includeAll || includeWidgets.includes('holidays')) {
      fetchPromises.push(
        Holiday.find({
          date: { $gte: new Date() }
        })
          .sort({ date: 1 })
          .limit(5)
          .lean()
          .then(holidays => {
            dashboardData.holidays = holidays
          })
          .catch(() => { dashboardData.holidays = [] })
      )
    }

    // === ANNOUNCEMENTS (for all roles) ===
    if (includeAll || includeWidgets.includes('announcements')) {
      fetchPromises.push(
        Announcement.find({
          isActive: true,
          $or: [
            { expiresAt: { $gte: new Date() } },
            { expiresAt: null }
          ]
        })
          .sort({ createdAt: -1 })
          .limit(5)
          .lean()
          .then(announcements => {
            dashboardData.announcements = announcements
          })
          .catch(() => { dashboardData.announcements = [] })
      )
    }

    // === MY ASSETS (for employees) ===
    if (employeeId && (includeAll || includeWidgets.includes('assets'))) {
      fetchPromises.push(
        Asset.find({ assignedTo: employeeId })
          .select('name type serialNumber status')
          .lean()
          .then(assets => {
            dashboardData.myAssets = assets
          })
          .catch(() => { dashboardData.myAssets = [] })
      )
    }

    // === MY EXPENSES (for employees) ===
    if (employeeId && (includeAll || includeWidgets.includes('expenses'))) {
      fetchPromises.push(
        Expense.find({ employee: employeeId })
          .sort({ createdAt: -1 })
          .limit(5)
          .select('title amount status category createdAt')
          .lean()
          .then(expenses => {
            dashboardData.myExpenses = expenses
          })
          .catch(() => { dashboardData.myExpenses = [] })
      )
    }

    // === MY HELPDESK TICKETS (for employees) ===
    if (employeeId && (includeAll || includeWidgets.includes('helpdesk'))) {
      fetchPromises.push(
        Ticket.find({
          $or: [{ createdBy: employeeId }, { assignedTo: employeeId }]
        })
          .sort({ createdAt: -1 })
          .limit(5)
          .select('title status priority category createdAt')
          .lean()
          .then(tickets => {
            dashboardData.myHelpdesk = tickets
          })
          .catch(() => { dashboardData.myHelpdesk = [] })
      )
    }

    // === POLICIES (for employees) ===
    if (includeAll || includeWidgets.includes('policies')) {
      fetchPromises.push(
        Policy.find({ isActive: true })
          .sort({ createdAt: -1 })
          .limit(5)
          .select('title category effectiveDate')
          .lean()
          .then(policies => {
            dashboardData.policies = policies
          })
          .catch(() => { dashboardData.policies = [] })
      )
    }

    // === TODAY'S ATTENDANCE (for employee) ===
    if (employeeId && (includeAll || includeWidgets.includes('attendance'))) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)

      fetchPromises.push(
        Attendance.findOne({
          employee: employeeId,
          date: { $gte: today, $lt: tomorrow }
        })
          .lean()
          .then(attendance => {
            dashboardData.todayAttendance = attendance
          })
          .catch(() => { dashboardData.todayAttendance = null })
      )
    }

    // === LEAVE BALANCE (for employee) ===
    if (employeeId && (includeAll || includeWidgets.includes('leaveBalance'))) {
      fetchPromises.push(
        LeaveBalance.find({ employee: employeeId })
          .populate('leaveType', 'name code color')
          .lean()
          .then(balances => {
            dashboardData.leaveBalance = balances
          })
          .catch(() => { dashboardData.leaveBalance = [] })
      )
    }

    // === MANAGEMENT DATA ===
    if (isManagement) {
      // Pending leave requests
      if (includeAll || includeWidgets.includes('leaveRequests')) {
        fetchPromises.push(
          Leave.find({ status: 'pending' })
            .populate('employee', 'firstName lastName profilePicture employeeCode')
            .populate('leaveType', 'name code')
            .sort({ createdAt: -1 })
            .limit(10)
            .lean()
            .then(leaves => {
              dashboardData.pendingLeaveRequests = leaves
            })
            .catch(() => { dashboardData.pendingLeaveRequests = [] })
        )
      }
    }

    // === HR/ADMIN DATA ===
    if (isHRLevel) {
      // Department stats
      if (includeAll || includeWidgets.includes('departments')) {
        fetchPromises.push(
          Department.find({ isActive: true })
            .select('name employeeCount')
            .lean()
            .then(departments => {
              dashboardData.departments = departments
            })
            .catch(() => { dashboardData.departments = [] })
        )
      }

      // Today's attendance summary
      if (includeAll || includeWidgets.includes('attendanceSummary')) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const tomorrow = new Date(today)
        tomorrow.setDate(tomorrow.getDate() + 1)

        fetchPromises.push(
          Promise.all([
            Employee.countDocuments({ status: 'active' }),
            Attendance.countDocuments({ date: { $gte: today, $lt: tomorrow } }),
            Attendance.countDocuments({
              date: { $gte: today, $lt: tomorrow },
              status: 'late'
            })
          ])
            .then(([totalEmployees, presentToday, lateToday]) => {
              dashboardData.attendanceSummary = {
                totalEmployees,
                presentToday,
                absentToday: totalEmployees - presentToday,
                lateToday
              }
            })
            .catch(() => {
              dashboardData.attendanceSummary = {
                totalEmployees: 0,
                presentToday: 0,
                absentToday: 0,
                lateToday: 0
              }
            })
        )
      }
    }

    // Wait for all parallel fetches to complete
    await Promise.allSettled(fetchPromises)

    // Cache the result for 2 minutes
    await setCache(cacheKey, dashboardData, 120)

    return NextResponse.json(dashboardData)

  } catch (error) {
    console.error('[Dashboard Unified API] Error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch dashboard data' },
      { status: 500 }
    )
  }
}
