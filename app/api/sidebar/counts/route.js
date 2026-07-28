import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'
import { getTenantCompanyFeaturePayload } from '@/lib/companyFeatures.server'

export const dynamic = 'force-dynamic'

const EMPTY_COUNTS = Object.freeze({
  projects: 0,
  tasks: 0,
  leaves: 0,
  attendance: 0,
  expenses: 0,
  helpdesk: 0,
  notifications: 0,
})

// GET - Get pending counts for sidebar badges
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, [
      'User', 'Employee', 'Department', 'ProjectMember', 'Leave', 'AttendanceCorrection',
      'Expense', 'Helpdesk', 'Notification', 'TaskAssignee'
    ])

    if (!auth.success) {
      // Return empty counts instead of 401 to avoid console errors
      return NextResponse.json({
        success: true,
        data: EMPTY_COUNTS
      })
    }

    const { user, models, tenant } = auth
    const {
      User, Employee, Department, ProjectMember, Leave, AttendanceCorrection,
      Expense, Helpdesk, Notification, TaskAssignee
    } = models

    // Check the cache before user/feature lookups.
    const cacheKey = buildCacheKey({
      tenantId: tenant?.databaseName,
      role: user.role || 'employee',
      userId: user._id || user.userId,
      namespace: 'sidebar:counts',
    })
    const cached = await getCache(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const [featurePayload, userRecord] = await Promise.all([
      getTenantCompanyFeaturePayload({
        companySlug: tenant?.companySlug,
        databaseName: tenant?.databaseName,
      }).catch((featureError) => {
        console.error('Error resolving company features for sidebar counts:', featureError)
        return null
      }),
      User.findById(user._id || user.userId)
        .select('employeeId role isDepartmentHead headOfDepartments')
        .lean(),
    ])
    const companyFeatures = featurePayload?.features || null

    if (!userRecord?.employeeId) {
      return NextResponse.json({
        success: true,
        data: EMPTY_COUNTS
      })
    }

    const employeeId = userRecord.employeeId
    const userRole = userRecord.role || user.role

    const counts = { ...EMPTY_COUNTS }

    // 1-3. Base counts in parallel
    const [projectCount, taskCount, notificationCount] = await Promise.all([
      companyFeatures?.projects === false
        ? Promise.resolve(0)
        : ProjectMember.countDocuments({
          user: employeeId,
          invitationStatus: 'invited'
        }).catch((err) => {
          console.error('Error counting project invitations:', err.message)
          return 0
        }),
      companyFeatures?.projects === false
        ? Promise.resolve(0)
        : TaskAssignee
          ? TaskAssignee.countDocuments({
            user: employeeId,
            assignmentStatus: 'pending'
          }).catch((err) => {
            console.error('Error counting task assignments:', err.message)
            return 0
          })
          : Promise.resolve(0),
      Notification.countDocuments({
        user: user._id || user.userId,
        read: false
      }).catch((err) => {
        console.error('Error counting notifications:', err.message)
        return 0
      })
    ])

    counts.projects = projectCount
    counts.tasks = taskCount
    counts.notifications = notificationCount

    // For managers, department heads, HR, and admins - count pending approvals
    // NOTE: HR users should ONLY see approvals if they're a department head (for their own department)
    // This prevents regular HR employees from seeing all company-wide approvals - only their dept head handles their approvals
    const isDeptHead = userRecord?.isDepartmentHead === true

    // Only admin sees company-wide counts
    // HR users need to be department heads to see their department's counts
    // Managers and department_head role users see their department's counts
    const canApprove = userRole === 'admin' ||
      isDeptHead ||
      (userRole === 'manager') ||
      (userRole === 'department_head')

    if (canApprove) {
      // Determine if this user should have department-scoped view
      // Only admin sees company-wide counts
      // Everyone else (including HR who is dept head) sees only their department's counts
      const hasDeptScopedView = userRole !== 'admin'

      // For users with department-scoped view, find departments they manage
      let departmentEmployeeIds = []

      if (hasDeptScopedView) {
        // Get departments from headOfDepartments array on User model first
        let managedDeptIds = []
        if (userRecord?.headOfDepartments?.length > 0) {
          managedDeptIds = userRecord.headOfDepartments
        }

        // Also check Department model for head/heads fields
        const managedDepartmentIds = await Department.find({
          $or: [
            { head: employeeId },
            { heads: employeeId },
            { _id: { $in: managedDeptIds } }
          ]
        }).distinct('_id')

        if (managedDepartmentIds.length > 0) {
          departmentEmployeeIds = await Employee.find({
            $or: [
              { department: { $in: managedDepartmentIds } },
              { departments: { $in: managedDepartmentIds } },
            ],
          }).distinct('_id')
        }
      }

      // 4. Pending leave approvals (exclude user's own leave requests)
      const leaveQuery = {
        status: 'pending',
        employee: { $ne: employeeId } // Exclude own leave requests
      }

      const correctionQuery = {
        status: 'pending',
        employee: { $ne: employeeId } // Exclude own corrections
      }

      const expenseQuery = {
        status: 'pending',
        employee: { $ne: employeeId } // Exclude own expenses
      }

      // Department heads/managers only see their managed departments' items
      if (hasDeptScopedView && departmentEmployeeIds.length > 0) {
        const filteredIds = departmentEmployeeIds.filter(id => id.toString() !== employeeId.toString())
        leaveQuery.employee = { $in: filteredIds }
        correctionQuery.employee = { $in: filteredIds }
        expenseQuery.employee = { $in: filteredIds }
      } else if (hasDeptScopedView) {
        leaveQuery._id = null
        correctionQuery._id = null
        expenseQuery._id = null
      }

      const [leaveCount, attendanceCount, expenseCount, helpdeskCount] = await Promise.all([
        companyFeatures?.leaveManagement === false
          ? Promise.resolve(0)
          : Leave.countDocuments(leaveQuery).catch((err) => {
            console.error('Error counting leave approvals:', err.message)
            return 0
          }),
        companyFeatures?.gpsAttendance === false
          ? Promise.resolve(0)
          : AttendanceCorrection.countDocuments(correctionQuery).catch((err) => {
            console.error('Error counting attendance corrections:', err.message)
            return 0
          }),
        companyFeatures?.expenses === false
          ? Promise.resolve(0)
          : Expense.countDocuments(expenseQuery).catch((err) => {
            console.error('Error counting expenses:', err.message)
            return 0
          }),
        ['admin', 'hr'].includes(userRole) && companyFeatures?.helpdesk !== false
          ? Helpdesk.countDocuments({ status: { $in: ['open', 'in-progress'] } }).catch((err) => {
            console.error('Error counting helpdesk tickets:', err.message)
            return 0
          })
          : Promise.resolve(0)
      ])

      counts.leaves = leaveCount
      counts.attendance = attendanceCount
      counts.expenses = expenseCount
      counts.helpdesk = helpdeskCount
    }

    const responseData = { success: true, data: counts }
    // Cache for 30s - short enough to reflect real changes, long enough to reduce DB hits
    void setCache(cacheKey, responseData, 60).catch(() => {}) // 60s TTL

    return NextResponse.json(responseData)
  } catch (error) {
    console.error('Sidebar counts error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
