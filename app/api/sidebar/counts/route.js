import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

// GET - Get pending counts for sidebar badges
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, [
      'User', 'Employee', 'ProjectMember', 'Leave', 'AttendanceCorrection',
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
      User, Employee, ProjectMember, Leave, AttendanceCorrection,
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
      // Get employee's department for department head scope
      const employee = await Employee.findById(employeeId).select('department')
      const departmentId = employee?.department

      // 3. Pending leave approvals
      try {
        const leaveQuery = { status: 'pending' }
        
        // Department heads only see their department's leaves
        if (userRole === 'department_head' && departmentId) {
          const deptEmployees = await Employee.find({ department: departmentId }).select('_id')
          leaveQuery.employee = { $in: deptEmployees.map(e => e._id) }
        }
        
        counts.leaves = await Leave.countDocuments(leaveQuery)
      } catch (err) {
        console.error('Error counting leave approvals:', err.message)
      }

      // 4. Pending attendance corrections
      try {
        const correctionQuery = { status: 'pending' }
        
        if (userRole === 'department_head' && departmentId) {
          const deptEmployees = await Employee.find({ department: departmentId }).select('_id')
          correctionQuery.employee = { $in: deptEmployees.map(e => e._id) }
        }
        
        counts.attendance = await AttendanceCorrection.countDocuments(correctionQuery)
      } catch (err) {
        console.error('Error counting attendance corrections:', err.message)
      }

      // 5. Pending expense approvals
      try {
        const expenseQuery = { status: 'pending' }
        
        if (userRole === 'department_head' && departmentId) {
          const deptEmployees = await Employee.find({ department: departmentId }).select('_id')
          expenseQuery.employee = { $in: deptEmployees.map(e => e._id) }
        }
        
        counts.expenses = await Expense.countDocuments(expenseQuery)
      } catch (err) {
        console.error('Error counting expenses:', err.message)
      }

      // 6. Pending helpdesk tickets (for IT/HR admins)
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
