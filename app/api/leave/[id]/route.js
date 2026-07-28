import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendLeaveApprovedNotification, sendLeaveRejectedNotification } from '@/lib/notificationService'
import {
  emitLeaveUpdate,
  emitRealtimeEvent,
  REALTIME_EVENTS,
} from '@/lib/realtimeEvents'
import { emitEvent, EVENTS } from '@/lib/eventBus'
import { isDirectReport } from '@/lib/teamScope'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'
import {
  buildLeaveBalanceFields,
  normalizeLeaveBalance,
  normalizeLeaveRequest,
} from '@/lib/leaveData'

// PUT - Update leave status (Approve/Reject)
export async function PUT(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Leave', 'LeaveBalance', 'Employee', 'User', 'Department'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models, tenant } = auth
    const { Leave, LeaveBalance, Employee, User, Department } = models
    const { id } = await params

    const data = await request.json()
    const { status, approvedBy, rejectionReason } = data

    if (!['approved', 'rejected'].includes(status)) {
      return NextResponse.json(
        { success: false, message: 'Status must be approved or rejected' },
        { status: 400 }
      )
    }

    const leave = await Leave.findById(id)
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
      const leaveEmployee = await Employee.findById(leave.employee)
        .select('department reportingManager manager assignedManager supervisor')
        .lean()

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
        // Managers can approve for their direct reports (any of the relationship fields)
        const isReport = isDirectReport(leaveEmployee, userEmployeeId)
        if (!isReport) {
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
    leave.approvedBy = userEmployeeId || approvedBy
    leave.approvalDate = new Date()

    if (status === 'rejected') {
      leave.rejectionReason = rejectionReason
    }

    if (status === 'approved') {
      // Deduct from leave balance
      if (leave.leaveType) {
        const leaveBalance = await LeaveBalance.findOne({
          employee: leave.employee,
          leaveType: leave.leaveType,
          year: new Date(leave.startDate).getUTCFullYear(),
        })

        if (!leaveBalance) {
          return NextResponse.json(
            { success: false, message: 'No leave balance was found for this request' },
            { status: 400 }
          )
        }

        const normalizedBalance = normalizeLeaveBalance(leaveBalance)
        const numberOfDays = Number(leave.numberOfDays ?? leave.days ?? 0)
        if (normalizedBalance.remainingDays < numberOfDays) {
          return NextResponse.json(
            {
              success: false,
              message: `Insufficient leave balance. Available: ${normalizedBalance.remainingDays} day(s)`,
            },
            { status: 400 }
          )
        }

        leaveBalance.set(buildLeaveBalanceFields({
          totalDays: normalizedBalance.totalDays,
          usedDays: normalizedBalance.usedDays + numberOfDays,
          pending: normalizedBalance.pending,
          carriedForward: normalizedBalance.carriedForward,
          remainingDays: normalizedBalance.remainingDays - numberOfDays,
        }))
        await leaveBalance.save()
      }
    }

    await leave.save()

    const populatedLeave = await Leave.findById(leave._id)
      .populate('employee', 'firstName lastName employeeCode')
      .populate('leaveType', 'name')
      .populate('approvedBy', 'firstName lastName')
      .lean()
    const responseLeave = normalizeLeaveRequest(populatedLeave)
    const employeeUser = await User.findOne({ employeeId: leave.employee }).select('_id').lean()
    const employeeUserId = employeeUser?._id?.toString()

    try {
      await Promise.all([
        clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'leave-balance', userId: '*' })),
        clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:unified', userId: '*' })),
        clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:employee-stats', userId: employeeUserId || '*' })),
        clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:manager-stats', userId: '*' })),
        clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:hr-stats', userId: '*' })),
      ])
    } catch (cacheError) {
      console.error('Failed to clear leave approval caches:', cacheError)
    }

    // Send notification to employee
    try {
      const employee = await Employee.findById(leave.employee).select('userId')
      const notificationUserId = employee?.userId || employeeUserId

      if (notificationUserId) {
        const leaveTypeName = responseLeave.leaveType?.name || 'Leave'
        const startDate = new Date(leave.startDate).toLocaleDateString()
        const endDate = new Date(leave.endDate).toLocaleDateString()

        if (status === 'approved') {
          await sendLeaveApprovedNotification({
            leaveId: leave._id.toString(),
            employeeId: notificationUserId,
            leaveType: leaveTypeName,
            startDate,
            endDate,
            approvedBy: approvedBy
          })
        } else if (status === 'rejected') {
          await sendLeaveRejectedNotification({
            leaveId: leave._id.toString(),
            employeeId: notificationUserId,
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
          io.to(`user:${notificationUserId}`).emit('leave-status-update', {
            leave: responseLeave,
            action: status,
            message: status === 'approved'
              ? `Your ${leaveTypeName} has been approved (${startDate} - ${endDate})`
              : `Your ${leaveTypeName} has been rejected`,
            timestamp: new Date()
          })
          console.log(`✅ [Socket.IO] Leave status update sent to user:${notificationUserId}`)
        }

        // Send FCM push notification (for when app is closed)
        try {
          const { sendPushToUser } = require('@/lib/pushNotification')
          const icon = status === 'approved' ? '✅' : '❌'
          await sendPushToUser(
            notificationUserId,
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
          console.log(`📲 [FCM] Leave notification sent to user:${notificationUserId}`)
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
          employee: responseLeave.employee,
          leaveType: responseLeave.leaveType,
          startDate: leave.startDate,
          endDate: leave.endDate,
          numberOfDays: leave.numberOfDays,
          status: leave.status,
          approvedBy: responseLeave.approvedBy
        },
        targetUserIds,
        { action: status }
      )
    } catch (emitError) {
      console.error('Failed to emit leave update to dashboards:', emitError)
    }

    // Emit sidebar counts update via eventBus (triggers cache invalidation + webhook)
    try {
      const affectedUserIds = [employeeUserId].filter(Boolean)
      emitEvent(EVENTS.LEAVE_STATUS_CHANGED, {
        leaveId: leave._id.toString(),
        status: leave.status,
        employeeId: leave.employee.toString(),
      }, {
        userIds: affectedUserIds,
        databaseName: tenant?.databaseName,
      })
    } catch (eventBusError) {
      console.error('Failed to emit eventBus leave event:', eventBusError)
    }

    return NextResponse.json({
      success: true,
      message: `Leave request ${status} successfully`,
      data: responseLeave,
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
    const auth = await getAuthAndModels(request, ['Leave', 'LeaveBalance', 'User'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models, tenant } = auth
    const { Leave, LeaveBalance, User } = models
    const { id } = await params

    const leave = await Leave.findById(id)
    if (!leave) {
      return NextResponse.json(
        { success: false, message: 'Leave request not found' },
        { status: 404 }
      )
    }

    const userRecord = await User.findById(user._id || user.userId)
      .select('employeeId role')
      .lean()
    const userRole = userRecord?.role || user.role
    const userEmployeeId = userRecord?.employeeId || user.employeeId
    const isOwner = userEmployeeId && String(userEmployeeId) === String(leave.employee)

    if (!isOwner && !['admin', 'hr'].includes(userRole)) {
      return NextResponse.json(
        { success: false, message: 'You can only cancel your own leave request' },
        { status: 403 }
      )
    }

    if (leave.status === 'approved') {
      // Restore leave balance
      const leaveBalance = await LeaveBalance.findOne({
        employee: leave.employee,
        leaveType: leave.leaveType,
        year: new Date(leave.startDate).getUTCFullYear(),
      })

      if (leaveBalance) {
        const normalizedBalance = normalizeLeaveBalance(leaveBalance)
        const numberOfDays = Number(leave.numberOfDays ?? leave.days ?? 0)
        leaveBalance.set(buildLeaveBalanceFields({
          totalDays: normalizedBalance.totalDays,
          usedDays: Math.max(0, normalizedBalance.usedDays - numberOfDays),
          pending: normalizedBalance.pending,
          carriedForward: normalizedBalance.carriedForward,
          remainingDays: Math.min(
            normalizedBalance.totalDays + normalizedBalance.carriedForward,
            normalizedBalance.remainingDays + numberOfDays
          ),
        }))
        await leaveBalance.save()
      }
    }

    await Leave.findByIdAndDelete(id)

    const employeeUser = await User.findOne({ employeeId: leave.employee }).select('_id').lean()
    const employeeUserId = employeeUser?._id?.toString()
    try {
      await Promise.all([
        clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'leave-balance', userId: '*' })),
        clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:unified', userId: '*' })),
        clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:employee-stats', userId: employeeUserId || '*' })),
        clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:manager-stats', userId: '*' })),
        clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'dashboard:hr-stats', userId: '*' })),
      ])
    } catch (cacheError) {
      console.error('Failed to clear leave cancellation caches:', cacheError)
    }

    try {
      emitRealtimeEvent(REALTIME_EVENTS.LEAVE_CANCELLED, {
        leave: {
          _id: leave._id,
          employee: leave.employee,
          leaveType: leave.leaveType,
          status: 'cancelled',
        },
        action: 'cancelled',
      }, { userIds: employeeUserId ? [employeeUserId] : [] })

      emitEvent(EVENTS.LEAVE_STATUS_CHANGED, {
        leaveId: leave._id.toString(),
        status: 'cancelled',
        employeeId: leave.employee.toString(),
      }, {
        userIds: [employeeUserId].filter(Boolean),
        databaseName: tenant?.databaseName,
      })
    } catch (emitError) {
      console.error('Failed to emit leave cancellation:', emitError)
    }

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

