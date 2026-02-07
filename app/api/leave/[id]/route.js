import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendLeaveApprovedNotification, sendLeaveRejectedNotification } from '@/lib/notificationService'
import { emitLeaveUpdate, emitDashboardRefresh } from '@/lib/realtimeEvents'

// PUT - Update leave status (Approve/Reject)
export async function PUT(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Leave', 'LeaveBalance', 'Employee', 'User', 'Department'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Leave, LeaveBalance, Employee, User, Department } = models

    const data = await request.json()
    const { status, approvedBy, rejectionReason } = data

    const leave = await Leave.findById(params.id)
    if (!leave) {
      return NextResponse.json(
        { success: false, message: 'Leave request not found' },
        { status: 404 }
      )
    }

    // Authorization check: Verify user can approve this leave
    const userRecord = await User.findById(user._id || user.userId)
      .select('employeeId role isDepartmentHead headOfDepartments')
      .lean()
    
    const userRole = userRecord?.role || user.role
    const userEmployeeId = userRecord?.employeeId

    // Admin can approve all leaves
    if (userRole !== 'admin') {
      // Get the employee who requested leave
      const leaveEmployee = await Employee.findById(leave.employee).select('department').lean()
      
      if (userRole === 'hr') {
        // HR users can ONLY approve if they're a department head of the employee's department
        if (!userRecord?.isDepartmentHead || !userRecord?.headOfDepartments?.length) {
          return NextResponse.json(
            { success: false, message: 'Only your department head can approve leave requests' },
            { status: 403 }
          )
        }
        // Check if employee is in HR's department
        const isInHRDept = userRecord.headOfDepartments.some(d => 
          d.toString() === leaveEmployee?.department?.toString()
        )
        if (!isInHRDept) {
          return NextResponse.json(
            { success: false, message: 'You can only approve leaves for your own department' },
            { status: 403 }
          )
        }
      } else if (userRole === 'department_head' || userRecord?.isDepartmentHead) {
        // Department heads can approve for their department
        let canApprove = false
        
        if (userRecord?.headOfDepartments?.length > 0) {
          canApprove = userRecord.headOfDepartments.some(d => 
            d.toString() === leaveEmployee?.department?.toString()
          )
        }
        
        if (!canApprove && userEmployeeId) {
          // Check via Department.head/heads
          const dept = await Department.findById(leaveEmployee?.department).lean()
          if (dept) {
            canApprove = dept.head?.toString() === userEmployeeId.toString() ||
              (dept.heads && dept.heads.some(h => h.toString() === userEmployeeId.toString()))
          }
        }
        
        if (!canApprove) {
          return NextResponse.json(
            { success: false, message: 'You can only approve leaves for your own department' },
            { status: 403 }
          )
        }
      } else if (userRole === 'manager') {
        // Managers can approve for their direct reports
        const isDirectReport = leaveEmployee?.reportingManager?.toString() === userEmployeeId?.toString()
        if (!isDirectReport) {
          return NextResponse.json(
            { success: false, message: 'You can only approve leaves for your direct reports' },
            { status: 403 }
          )
        }
      } else {
        return NextResponse.json(
          { success: false, message: 'You do not have permission to approve leave requests' },
          { status: 403 }
        )
      }
    }

    if (leave.status !== 'pending') {
      return NextResponse.json(
        { success: false, message: 'Leave request already processed' },
        { status: 400 }
      )
    }

    leave.status = status
    leave.approvedBy = approvedBy
    leave.approvalDate = new Date()

    if (status === 'rejected') {
      leave.rejectionReason = rejectionReason
    }

    if (status === 'approved') {
      // Deduct from leave balance
      const leaveBalance = await LeaveBalance.findOne({
        employee: leave.employee,
        leaveType: leave.leaveType,
      })

      if (leaveBalance) {
        leaveBalance.used += leave.numberOfDays
        leaveBalance.available -= leave.numberOfDays
        await leaveBalance.save()
      }
    }

    await leave.save()

    const populatedLeave = await Leave.findById(leave._id)
      .populate('employee', 'firstName lastName employeeCode')
      .populate('leaveType', 'name')
      .populate('approvedBy', 'firstName lastName')

    // Send notification to employee
    try {
      const employee = await Employee.findById(leave.employee).select('userId')
      const employeeUserId = employee?.userId

      if (employeeUserId) {
        const leaveTypeName = populatedLeave.leaveType?.name || 'Leave'
        const startDate = new Date(leave.startDate).toLocaleDateString()
        const endDate = new Date(leave.endDate).toLocaleDateString()

        if (status === 'approved') {
          await sendLeaveApprovedNotification({
            leaveId: leave._id.toString(),
            employeeId: employeeUserId,
            leaveType: leaveTypeName,
            startDate,
            endDate,
            approvedBy: approvedBy
          })
        } else if (status === 'rejected') {
          await sendLeaveRejectedNotification({
            leaveId: leave._id.toString(),
            employeeId: employeeUserId,
            leaveType: leaveTypeName,
            startDate,
            endDate,
            rejectedBy: approvedBy,
            reason: rejectionReason
          })
        }

        // Emit Socket.IO event for realtime notification with sound
        const io = global.io
        if (io) {
          io.to(`user:${employeeUserId}`).emit('leave-status-update', {
            leave: populatedLeave,
            action: status,
            message: status === 'approved'
              ? `Your ${leaveTypeName} has been approved (${startDate} - ${endDate})`
              : `Your ${leaveTypeName} has been rejected`,
            timestamp: new Date()
          })
          console.log(`✅ [Socket.IO] Leave status update sent to user:${employeeUserId}`)
        }

        // Send FCM push notification (for when app is closed)
        try {
          const { sendPushToUser } = require('@/lib/pushNotification')
          const icon = status === 'approved' ? '✅' : '❌'
          await sendPushToUser(
            employeeUserId,
            {
              title: `${icon} Leave ${status === 'approved' ? 'Approved' : 'Rejected'}`,
              body: status === 'approved'
                ? `Your ${leaveTypeName} has been approved (${startDate} - ${endDate})`
                : `Your ${leaveTypeName} has been rejected`,
            },
            {
              clickAction: '/dashboard/leave',
              eventType: 'leave_status',
              data: {
                leaveId: leave._id.toString(),
                status,
                type: 'leave_status_update'
              }
            }
          )
          console.log(`📲 [FCM] Leave notification sent to user:${employeeUserId}`)
        } catch (fcmError) {
          console.error('Failed to send FCM notification:', fcmError)
        }
      }
    } catch (notifError) {
      console.error('Failed to send leave status notification:', notifError)
    }

    // Emit real-time update to all admin/HR dashboards for live refresh
    try {
      const adminUsers = await User.find({ role: { $in: ['admin', 'hr', 'manager'] }, isActive: true }).select('_id').lean()
      const targetUserIds = adminUsers.map(u => u._id.toString())
      
      emitLeaveUpdate(
        {
          _id: leave._id,
          employee: populatedLeave.employee,
          leaveType: populatedLeave.leaveType,
          startDate: leave.startDate,
          endDate: leave.endDate,
          numberOfDays: leave.numberOfDays,
          status: leave.status,
          approvedBy: populatedLeave.approvedBy
        },
        targetUserIds,
        { action: status }
      )
    } catch (emitError) {
      console.error('Failed to emit leave update to dashboards:', emitError)
    }

    return NextResponse.json({
      success: true,
      message: `Leave request ${status} successfully`,
      data: populatedLeave,
    })
  } catch (error) {
    console.error('Update leave error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update leave' },
      { status: 500 }
    )
  }
}

// DELETE - Cancel leave request
export async function DELETE(request, { params }) {
  try {
    const leave = await Leave.findById(params.id)
    if (!leave) {
      return NextResponse.json(
        { success: false, message: 'Leave request not found' },
        { status: 404 }
      )
    }

    if (leave.status === 'approved') {
      // Restore leave balance
      const leaveBalance = await LeaveBalance.findOne({
        employee: leave.employee,
        leaveType: leave.leaveType,
      })

      if (leaveBalance) {
        leaveBalance.used -= leave.numberOfDays
        leaveBalance.available += leave.numberOfDays
        await leaveBalance.save()
      }
    }

    await Leave.findByIdAndDelete(params.id)

    return NextResponse.json({
      success: true,
      message: 'Leave request cancelled successfully',
    })
  } catch (error) {
    console.error('Delete leave error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to cancel leave request' },
      { status: 500 }
    )
  }
}

