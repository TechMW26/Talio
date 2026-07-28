import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPushToUser } from '@/lib/pushNotification'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'
import { emitEvent, EVENTS } from '@/lib/eventBus'
import {
  buildLeaveBalanceFields,
  normalizeLeaveBalance,
  normalizeLeaveRequest,
} from '@/lib/leaveData'

// PUT - Approve or reject leave request
export async function PUT(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Leave', 'LeaveBalance', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models, tenant } = auth
    const { Leave, LeaveBalance, User, Employee } = models

    // Await params in Next.js 15
    const { id } = await params
    const { action, reason, approvedBy } = await request.json()

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { success: false, message: 'Invalid action. Must be approve or reject' },
        { status: 400 }
      )
    }

    // Find the leave request
    const leaveRequest = await Leave.findById(id)
    if (!leaveRequest) {
      return NextResponse.json(
        { success: false, message: 'Leave request not found' },
        { status: 404 }
      )
    }

    if (leaveRequest.status !== 'pending') {
      return NextResponse.json(
        { success: false, message: 'Leave request has already been processed' },
        { status: 400 }
      )
    }

    // Update leave request status
    const updateData = {
      status: action === 'approve' ? 'approved' : 'rejected',
      approvedBy,
      approvedDate: new Date(),
    }

    if (action === 'reject') {
      updateData.rejectionReason = reason
    } else if (reason) {
      updateData.approvalComments = reason
    }

    // If approving, update leave balance
    if (action === 'approve' && leaveRequest.leaveType) {
      const leaveBalance = await LeaveBalance.findOne({
        employee: leaveRequest.employee,
        leaveType: leaveRequest.leaveType,
        year: new Date(leaveRequest.startDate).getUTCFullYear(),
      })

      if (!leaveBalance) {
        return NextResponse.json(
          { success: false, message: 'No leave balance was found for this request' },
          { status: 400 }
        )
      }

      const normalizedBalance = normalizeLeaveBalance(leaveBalance)
      const numberOfDays = Number(leaveRequest.numberOfDays ?? leaveRequest.days ?? 0)
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

    // Update the leave request
    const updatedLeave = await Leave.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    )
      .populate('employee', 'firstName lastName employeeCode')
      .populate('leaveType', 'name code')
      .populate('approvedBy', 'firstName lastName')
      .lean()
    const responseLeave = normalizeLeaveRequest(updatedLeave)

    const tenantId = tenant?.databaseName
    const employeeUser = await User.findOne({ employeeId: leaveRequest.employee }).select('_id')
    const employeeUserId = employeeUser?._id?.toString() || '*'

    await clearCachePattern(buildCachePattern({ tenantId, namespace: 'leave-balance', userId: employeeUserId }))
    await clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:unified', userId: '*' }))
    await clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:employee-stats', userId: employeeUserId }))
    await clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:manager-stats', userId: '*' }))
    await clearCachePattern(buildCachePattern({ tenantId, namespace: 'dashboard:hr-stats', userId: '*' }))

    // Send push notification to employee
    try {
      const approver = await Employee.findById(approvedBy).select('firstName lastName')

      if (employeeUser && approver) {
        const approverName = `${approver.firstName} ${approver.lastName}`
        const status = action === 'approve' ? 'approved' : 'rejected'
        const leaveTypeName = responseLeave.leaveType?.name || 'Leave'

        await sendPushToUser(
          employeeUser._id.toString(),
          {
            title: `Leave Request ${status === 'approved' ? 'Approved ✅' : 'Rejected ❌'}`,
            body: `${approverName} has ${status} your ${leaveTypeName} request for ${leaveRequest.numberOfDays} day(s)`,
          },
          {
            eventType: status === 'approved' ? 'leaveApproved' : 'leaveRejected',
            clickAction: `/dashboard/leave`,
            icon: '/icon-192x192.png',
            data: {
              leaveId: responseLeave._id.toString(),
              leaveType: leaveTypeName,
              status,
              approverName,
              numberOfDays: leaveRequest.numberOfDays,
            },
          }
        )

        console.log(`Leave ${status} notification sent to employee`)
      }
    } catch (notifError) {
      console.error('Failed to send leave status notification:', notifError)
    }

    // Emit sidebar counts update via eventBus
    try {
      emitEvent(EVENTS.LEAVE_STATUS_CHANGED, {
        leaveId: id,
        status: updateData.status,
        employeeId: leaveRequest.employee.toString(),
      }, {
        userIds: [employeeUserId].filter(Boolean),
        databaseName: tenant?.databaseName,
      })
    } catch (eventBusError) {
      console.error('Failed to emit eventBus leave event:', eventBusError)
    }

    return NextResponse.json({
      success: true,
      message: `Leave request ${action}d successfully`,
      data: responseLeave,
    })
  } catch (error) {
    console.error('Leave action error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to process leave request' },
      { status: 500 }
    )
  }
}
