import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { emitExpenseUpdate } from '@/lib/realtimeEvents'

// PUT - Update/Approve expense
export async function PUT(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Expense', 'User', 'Employee', 'Department'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Expense, User, Employee, Department } = models

    const data = await request.json()

    // Get the existing expense to check authorization
    const existingExpense = await Expense.findById(params.id).lean()
    if (!existingExpense) {
      return NextResponse.json(
        { success: false, message: 'Expense not found' },
        { status: 404 }
      )
    }

    // Authorization check for approval/rejection actions
    if (data.status && (data.status === 'approved' || data.status === 'rejected')) {
      const userRecord = await User.findById(user._id || user.userId)
        .select('employeeId role isDepartmentHead headOfDepartments')
        .lean()
      
      const userRole = userRecord?.role || user.role
      const userEmployeeId = userRecord?.employeeId

      // Admin can approve all expenses
      if (userRole !== 'admin') {
        // Get the employee who submitted expense
        const expenseEmployee = await Employee.findById(existingExpense.employee).select('department').lean()
        
        if (userRole === 'hr') {
          // HR users can ONLY approve if they're a department head of the employee's department
          if (!userRecord?.isDepartmentHead || !userRecord?.headOfDepartments?.length) {
            return NextResponse.json(
              { success: false, message: 'Only your department head can approve expense requests' },
              { status: 403 }
            )
          }
          // Check if employee is in HR's department
          const isInHRDept = userRecord.headOfDepartments.some(d => 
            d.toString() === expenseEmployee?.department?.toString()
          )
          if (!isInHRDept) {
            return NextResponse.json(
              { success: false, message: 'You can only approve expenses for your own department' },
              { status: 403 }
            )
          }
        } else if (userRole === 'department_head' || userRecord?.isDepartmentHead) {
          // Department heads can approve for their department
          let canApprove = false
          
          if (userRecord?.headOfDepartments?.length > 0) {
            canApprove = userRecord.headOfDepartments.some(d => 
              d.toString() === expenseEmployee?.department?.toString()
            )
          }
          
          if (!canApprove && userEmployeeId) {
            // Check via Department.head/heads
            const dept = await Department.findById(expenseEmployee?.department).lean()
            if (dept) {
              canApprove = dept.head?.toString() === userEmployeeId.toString() ||
                (dept.heads && dept.heads.some(h => h.toString() === userEmployeeId.toString()))
            }
          }
          
          if (!canApprove) {
            return NextResponse.json(
              { success: false, message: 'You can only approve expenses for your own department' },
              { status: 403 }
            )
          }
        } else if (userRole === 'manager') {
          // Managers can approve for their direct reports
          const isDirectReport = expenseEmployee?.reportingManager?.toString() === userEmployeeId?.toString()
          if (!isDirectReport) {
            return NextResponse.json(
              { success: false, message: 'You can only approve expenses for your direct reports' },
              { status: 403 }
            )
          }
        } else {
          return NextResponse.json(
            { success: false, message: 'You do not have permission to approve expense requests' },
            { status: 403 }
          )
        }
      }
    }

    const expense = await Expense.findByIdAndUpdate(
      params.id,
      data,
      { new: true, runValidators: true }
    )
      .populate('employee', 'firstName lastName employeeCode')
      .populate('approvedBy', 'firstName lastName')

    if (!expense) {
      return NextResponse.json(
        { success: false, message: 'Expense not found' },
        { status: 404 }
      )
    }

    // Emit Socket.IO event for realtime notification with sound
    try {
      if (data.status && (data.status === 'approved' || data.status === 'rejected')) {
        const employeeDoc = await Employee.findById(expense.employee._id || expense.employee).select('userId')
        const employeeUserId = employeeDoc?.userId

        if (employeeUserId) {
          const io = global.io
          if (io) {
            io.to(`user:${employeeUserId}`).emit('expense-status-update', {
              expense,
              action: data.status,
              message: `Your expense claim of ${expense.amount} has been ${data.status}`,
              timestamp: new Date()
            })
            console.log(`✅ [Socket.IO] Expense status update sent to user:${employeeUserId}`)
          }

          // Send FCM push notification
          try {
            const { sendPushToUser } = require('@/lib/pushNotification')
            const icon = data.status === 'approved' ? '✅' : '❌'
            await sendPushToUser(
              employeeUserId,
              {
                title: `${icon} Expense ${data.status === 'approved' ? 'Approved' : 'Rejected'}`,
                body: `Your expense claim of ₹${expense.amount} has been ${data.status}`,
              },
              {
                clickAction: '/dashboard/expenses',
                eventType: 'expense_status',
                data: {
                  expenseId: expense._id.toString(),
                  status: data.status,
                  type: 'expense_status_update'
                }
              }
            )
            console.log(`📲 [FCM] Expense notification sent to user:${employeeUserId}`)
          } catch (fcmError) {
            console.error('Failed to send expense FCM notification:', fcmError)
          }
        }

        // Emit real-time update to all admin/HR dashboards
        const adminUsers = await User.find({ role: { $in: ['admin', 'hr', 'manager'] }, isActive: true }).select('_id').lean()
        const targetUserIds = adminUsers.map(u => u._id.toString())
        
        emitExpenseUpdate(
          {
            _id: expense._id,
            employee: expense.employee,
            category: expense.category,
            amount: expense.amount,
            status: expense.status,
            approvedBy: expense.approvedBy
          },
          targetUserIds,
          { action: data.status }
        )
      }
    } catch (socketError) {
      console.error('Failed to send expense socket notification:', socketError)
    }

    return NextResponse.json({
      success: true,
      message: 'Expense updated successfully',
      data: expense,
    })
  } catch (error) {
    console.error('Update expense error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update expense' },
      { status: 500 }
    )
  }
}

// DELETE - Delete expense
export async function DELETE(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Expense'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Expense } = models

    const expense = await Expense.findByIdAndDelete(params.id)

    if (!expense) {
      return NextResponse.json(
        { success: false, message: 'Expense not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Expense deleted successfully',
    })
  } catch (error) {
    console.error('Delete expense error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete expense' },
      { status: 500 }
    )
  }
}

