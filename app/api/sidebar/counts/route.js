import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET - Get pending counts for sidebar badges
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, [
      'User', 'Employee', 'Department', 'ProjectMember', 'Leave', 'AttendanceCorrection',
      'Expense', 'Helpdesk', 'Notification', 'Task', 'TaskAssignee'
    ])

    if (!auth.success) {
      // Return empty counts instead of 401 to avoid console errors
      return NextResponse.json({
        success: true,
        data: {
          projects: 0,
          tasks: 0,
          leaves: 0,
          attendance: 0,
          expenses: 0,
          helpdesk: 0,
          notifications: 0
        }
      })
    }

    const { user, models } = auth
    const {
      User, Employee, Department, ProjectMember, Leave, AttendanceCorrection,
      Expense, Helpdesk, Notification, Task, TaskAssignee
    } = models

    const userRecord = await User.findById(user._id || user.userId)
      .select('employeeId role isDepartmentHead headOfDepartments')
      .lean()
    if (!userRecord?.employeeId) {
      return NextResponse.json({
        success: true,
        data: {
          projects: 0,
          tasks: 0,
          leaves: 0,
          attendance: 0,
          expenses: 0,
          helpdesk: 0,
          notifications: 0
        }
      })
    }

    const employeeId = userRecord.employeeId
    const userRole = userRecord.role || user.role

    const counts = {
      projects: 0,      // Pending project invitations for current user
      tasks: 0,         // Pending task assignments for current user
      leaves: 0,        // Pending leave approvals (for managers/heads/hr/admin)
      attendance: 0,    // Pending attendance corrections (for managers/heads/hr/admin)
      expenses: 0,      // Pending expense approvals (for managers/heads/hr/admin)
      helpdesk: 0,      // Pending helpdesk tickets (for assigned agents or admin)
      notifications: 0  // Unread notifications
    }

    // 1-3. Base counts in parallel
    const [projectCount, taskCount, notificationCount] = await Promise.all([
      ProjectMember.countDocuments({
        user: employeeId,
        invitationStatus: 'invited'
      }).catch((err) => {
        console.error('Error counting project invitations:', err.message)
        return 0
      }),
      TaskAssignee
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
        const managedDepartments = await Department.find({
          $or: [
            { head: employeeId },
            { heads: employeeId },
            { _id: { $in: managedDeptIds } }
          ]
        }).select('_id').lean()

        if (managedDepartments.length > 0) {
          const deptIds = managedDepartments.map(d => d._id)
          const deptEmployees = await Employee.find({ department: { $in: deptIds } }).select('_id').lean()
          departmentEmployeeIds = deptEmployees.map(e => e._id)
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
        Leave.countDocuments(leaveQuery).catch((err) => {
          console.error('Error counting leave approvals:', err.message)
          return 0
        }),
        AttendanceCorrection.countDocuments(correctionQuery).catch((err) => {
          console.error('Error counting attendance corrections:', err.message)
          return 0
        }),
        Expense.countDocuments(expenseQuery).catch((err) => {
          console.error('Error counting expenses:', err.message)
          return 0
        }),
        ['admin', 'hr'].includes(userRole)
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

    return NextResponse.json({
      success: true,
      data: counts
    })
  } catch (error) {
    console.error('Sidebar counts error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
