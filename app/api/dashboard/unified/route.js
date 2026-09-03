import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'
import { getTenantCompanyFeaturePayload } from '@/lib/companyFeatures.server'
import { normalizeLeaveBalances } from '@/lib/leaveData'

export const dynamic = 'force-dynamic'

const DASHBOARD_WIDGETS = new Set([
  'holidays',
  'announcements',
  'assets',
  'expenses',
  'helpdesk',
  'policies',
  'attendance',
  'leaveBalance',
  'leaveRequests',
  'departments',
  'attendanceSummary',
])

function parseWidgetSelection(searchParams) {
  const requested = (searchParams.get('widgets') || 'all')
    .split(',')
    .map((widget) => widget.trim())
    .filter(Boolean)

  if (requested.includes('all')) {
    return { includeAll: true, includeWidgets: ['all'] }
  }

  return {
    includeAll: false,
    includeWidgets: [...new Set(requested.filter((widget) => DASHBOARD_WIDGETS.has(widget)))].sort(),
  }
}

/**
 * Unified Dashboard API
 * Aggregates all widget data in a single request to reduce network calls
 * This significantly improves mobile performance on slow networks
 */
export async function GET(request) {
  try {
    // Parse query params for which widgets to include
    const { searchParams } = new URL(request.url)
    const { includeWidgets, includeAll } = parseWidgetSelection(searchParams)

    // Get authenticated user and tenant-specific models
    // Only load models that are actually queried in this route
    const auth = await getAuthAndModels(request, [
      'Attendance', 'LeaveBalance', 'LeaveType', 'Leave',
      'Employee', 'Department', 'User',
      'Holiday', 'Announcement', 'Asset', 'Expense', 'Ticket', 'Policy',
      'CompanySettings', 'Company'
    ])

    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }

    const { user, models, tenant } = auth
    const {
      Attendance, LeaveBalance, LeaveType, Leave,
      Employee, Department, User,
      Holiday, Announcement, Asset, Expense, Ticket, Policy,
      CompanySettings, Company
    } = models

    const userRole = user.role || 'employee'
    const isManagement = ['admin', 'department_head', 'hr', 'manager'].includes(userRole)
    const isHRLevel = ['admin', 'department_head', 'hr'].includes(userRole)

    // Build and check the cache before feature/profile database work.
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

    const [featurePayload, userWithEmployee] = await Promise.all([
      getTenantCompanyFeaturePayload({
        companySlug: tenant?.companySlug,
        databaseName: tenant?.databaseName,
      }).catch((featureError) => {
        console.error('[Dashboard Unified API] Failed to resolve company features:', featureError)
        return null
      }),
      User.findById(user._id || user.userId)
        .populate({
          path: 'employeeId',
          select: 'firstName lastName employeeCode designation department company profilePicture status email phone dateOfJoining employmentType reportingManager _id',
          populate: [
            { path: 'designation', select: 'title' },
            { path: 'department', select: 'name' },
            { path: 'reportingManager', select: 'firstName lastName' }
          ]
        })
        .lean(),
    ])

    const companyFeatures = featurePayload?.features || null
    const employee = userWithEmployee?.employeeId
    const employeeId = employee?._id

    // Initialize response object
    const dashboardData = {
      success: true,
      timestamp: new Date().toISOString(),
      companyFeatures,
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
        status: employee.status,
        email: employee.email,
        phone: employee.phone,
        dateOfJoining: employee.dateOfJoining,
        employmentType: employee.employmentType,
        reportingManager: employee.reportingManager,
        company: employee.company,
      }
    }

    // === HOLIDAYS (for all roles) ===
    // === COMPANY SETTINGS (for CheckInOutWidget work hours config) ===
    if (!companyFeatures || companyFeatures.gpsAttendance !== false) {
      fetchPromises.push(
        (employee?.company
          ? Company.findById(employee.company).select('name timezone workingHours geofence breakTimings').lean()
          : CompanySettings.findOne().lean())
          .then(settings => {
            dashboardData.companySettings = settings
              ? {
                  ...settings,
                  checkInTime: settings.checkInTime || settings.workingHours?.checkInTime,
                  checkOutTime: settings.checkOutTime || settings.workingHours?.checkOutTime,
                  absentThresholdMinutes: settings.absentThresholdMinutes || settings.workingHours?.absentThresholdMinutes,
                }
              : null
          })
          .catch(() => { dashboardData.companySettings = null })
      )
    } else {
      dashboardData.companySettings = null
    }

    if ((!companyFeatures || companyFeatures.holidays !== false) && (includeAll || includeWidgets.includes('holidays'))) {
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
    } else {
      dashboardData.holidays = []
    }

    // === ANNOUNCEMENTS (for all roles) ===
    if ((!companyFeatures || companyFeatures.announcements !== false) && (includeAll || includeWidgets.includes('announcements'))) {
      const now = new Date()
      fetchPromises.push(
        Announcement.find({
          $or: [
            { status: 'published' },
            { status: { $exists: false }, isActive: true },
            { status: null, isActive: true },
          ],
          $and: [{
            $or: [
              { expiryDate: { $exists: false }, expiresAt: { $exists: false } },
              { expiryDate: null, expiresAt: null },
              { expiryDate: { $gte: now } },
              { expiresAt: { $gte: now } },
            ]
          }]
        })
          .populate('createdBy', 'firstName lastName')
          .populate('departments', 'name')
          .sort({ createdAt: -1 })
          .limit(5)
          .lean()
          .then(announcements => {
            dashboardData.announcements = announcements
          })
          .catch(() => { dashboardData.announcements = [] })
      )
    } else {
      dashboardData.announcements = []
    }

    // === MY ASSETS (for employees) ===
    if (employeeId && (!companyFeatures || companyFeatures.assets !== false) && (includeAll || includeWidgets.includes('assets'))) {
      fetchPromises.push(
        Asset.find({ assignedTo: employeeId })
          .select('name assetCode category uin serialNumber manufacturer model status')
          .lean()
          .then(assets => {
            dashboardData.myAssets = assets
          })
          .catch(() => { dashboardData.myAssets = [] })
      )
    } else {
      dashboardData.myAssets = []
    }

    // === MY EXPENSES (for employees) ===
    if (employeeId && (!companyFeatures || companyFeatures.expenses !== false) && (includeAll || includeWidgets.includes('expenses'))) {
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
    } else {
      dashboardData.myExpenses = []
    }

    // === MY HELPDESK TICKETS (for employees) ===
    if (employeeId && (!companyFeatures || companyFeatures.helpdesk !== false) && (includeAll || includeWidgets.includes('helpdesk'))) {
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
    } else {
      dashboardData.myHelpdesk = []
    }

    // === POLICIES (for employees) ===
    if ((!companyFeatures || companyFeatures.policies !== false) && (includeAll || includeWidgets.includes('policies'))) {
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
    } else {
      dashboardData.policies = []
    }

    // === TODAY'S ATTENDANCE (for employee) ===
    if (employeeId && (!companyFeatures || companyFeatures.gpsAttendance !== false) && (includeAll || includeWidgets.includes('attendance'))) {
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
    } else {
      dashboardData.todayAttendance = null
    }

    // === LEAVE BALANCE (for employee) ===
    if (employeeId && (!companyFeatures || companyFeatures.leaveManagement !== false) && (includeAll || includeWidgets.includes('leaveBalance'))) {
      fetchPromises.push(
        LeaveBalance.find({ employee: employeeId })
          .populate('leaveType', 'name code color')
          .lean()
          .then(balances => {
            dashboardData.leaveBalance = normalizeLeaveBalances(balances)
          })
          .catch(() => { dashboardData.leaveBalance = [] })
      )
    } else {
      dashboardData.leaveBalance = []
    }

    // === MANAGEMENT DATA ===
    if (isManagement) {
      // Pending leave requests
      if ((!companyFeatures || companyFeatures.leaveManagement !== false) && (includeAll || includeWidgets.includes('leaveRequests'))) {
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
      } else {
        dashboardData.pendingLeaveRequests = []
      }
    }

    // === HR/ADMIN DATA ===
    if (isHRLevel) {
      // Department stats
      if ((!companyFeatures || companyFeatures.employees !== false) && (includeAll || includeWidgets.includes('departments'))) {
        fetchPromises.push(
          Department.find({ isActive: true })
            .select('name employeeCount')
            .lean()
            .then(departments => {
              dashboardData.departments = departments
            })
            .catch(() => { dashboardData.departments = [] })
        )
      } else {
        dashboardData.departments = []
      }

      // Today's attendance summary
      if ((!companyFeatures || companyFeatures.gpsAttendance !== false) && (includeAll || includeWidgets.includes('attendanceSummary'))) {
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
      } else {
        dashboardData.attendanceSummary = {
          totalEmployees: 0,
          presentToday: 0,
          absentToday: 0,
          lateToday: 0,
        }
      }
    }

    // Wait for all parallel fetches to complete
    await Promise.allSettled(fetchPromises)

    // Populate L1 synchronously and persist to Redis without adding network
    // latency to the dashboard response.
    void setCache(cacheKey, dashboardData, 5 * 60).catch(() => {})

    return NextResponse.json(dashboardData)

  } catch (error) {
    console.error('[Dashboard Unified API] Error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch dashboard data' },
      { status: 500 }
    )
  }
}
