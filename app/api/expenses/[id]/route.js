import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { emitExpenseUpdate } from '@/lib/realtimeEvents'

// PUT - Update/Approve expense
export async function PUT(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Expense', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Expense, User } = models

    const data = await request.json()

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
        const Employee = require('@/models/Employee').default
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

