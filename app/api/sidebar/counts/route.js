import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

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

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
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

    // 1. Project invitations for current user
    try {
      counts.projects = await ProjectMember.countDocuments({
        user: employeeId,
        invitationStatus: 'invited'
      })
    } catch (err) {
      console.error('Error counting project invitations:', err.message)
    }

    // 2. Pending task assignments for current user
    try {
      if (TaskAssignee) {
        counts.tasks = await TaskAssignee.countDocuments({
          employee: employeeId,
          invitationStatus: 'invited'
        })
      }
    } catch (err) {
      console.error('Error counting task assignments:', err.message)
    }

    // 3. Unread notifications
    try {
      counts.notifications = await Notification.countDocuments({
        user: user._id || user.userId,
        read: false
      })
    } catch (err) {
      console.error('Error counting notifications:', err.message)
    }

    // For managers, department heads, HR, and admins - count pending approvals
    const canApprove = ['admin', 'hr', 'manager', 'department_head'].includes(userRole)
    
    if (canApprove) {
      // Check if user is a department head (via User model flag OR role)
      const userDoc = await User.findById(user._id || user.userId).select('isDepartmentHead headOfDepartments').lean()
      const isDeptHead = userRole === 'department_head' || userDoc?.isDepartmentHead === true
      
      // Determine if this user should have department-scoped view
      // Only admin and HR see company-wide counts
      // Managers and department heads see only their department's counts
      const hasDeptScopedView = !['admin', 'hr'].includes(userRole)
      
      // For users with department-scoped view, find departments they manage
      let departmentEmployeeIds = []
      
      if (hasDeptScopedView) {
        // Get departments from headOfDepartments array on User model first
        let managedDeptIds = []
        if (userDoc?.headOfDepartments?.length > 0) {
          managedDeptIds = userDoc.headOfDepartments
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

      // 4. Pending leave approvals
      try {
        const leaveQuery = { status: 'pending' }
        
        // Department heads/managers only see their managed departments' leaves
        if (hasDeptScopedView && departmentEmployeeIds.length > 0) {
          leaveQuery.employee = { $in: departmentEmployeeIds }
        } else if (hasDeptScopedView) {
          // No departments managed, no pending leaves to show
          leaveQuery._id = null // Will return 0
        }
        
        counts.leaves = await Leave.countDocuments(leaveQuery)
      } catch (err) {
        console.error('Error counting leave approvals:', err.message)
      }

      // 5. Pending attendance corrections
      try {
        const correctionQuery = { status: 'pending' }
        
        if (hasDeptScopedView && departmentEmployeeIds.length > 0) {
          correctionQuery.employee = { $in: departmentEmployeeIds }
        } else if (hasDeptScopedView) {
          correctionQuery._id = null // Will return 0
        }
        
        counts.attendance = await AttendanceCorrection.countDocuments(correctionQuery)
      } catch (err) {
        console.error('Error counting attendance corrections:', err.message)
      }

      // 6. Pending expense approvals
      try {
        const expenseQuery = { status: 'pending' }
        
        if (hasDeptScopedView && departmentEmployeeIds.length > 0) {
          expenseQuery.employee = { $in: departmentEmployeeIds }
        } else if (hasDeptScopedView) {
          expenseQuery._id = null // Will return 0
        }
        
        counts.expenses = await Expense.countDocuments(expenseQuery)
      } catch (err) {
        console.error('Error counting expenses:', err.message)
      }

      // 7. Pending helpdesk tickets (for IT/HR admins only)
      if (['admin', 'hr'].includes(userRole)) {
        try {
          counts.helpdesk = await Helpdesk.countDocuments({
            status: { $in: ['open', 'in-progress'] }
          })
        } catch (err) {
          console.error('Error counting helpdesk tickets:', err.message)
        }
      }
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
