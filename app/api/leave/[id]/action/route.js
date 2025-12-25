import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPushToUser } from '@/lib/pushNotification'

// PUT - Approve or reject leave request
export async function PUT(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Leave', 'LeaveBalance', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Leave, LeaveBalance, User, Employee } = models

    const { id } = params
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
    if (action === 'approve') {
      const leaveBalance = await LeaveBalance.findOne({
        employee: leaveRequest.employee,
        leaveType: leaveRequest.leaveType,
        year: new Date(leaveRequest.startDate).getFullYear(),
      })

      if (leaveBalance) {
        // Check if there's sufficient balance
        if (leaveBalance.remainingDays < leaveRequest.numberOfDays) {
          return NextResponse.json(
            { success: false, message: 'Insufficient leave balance' },
            { status: 400 }
          )
        }

        // Update leave balance
        leaveBalance.usedDays += leaveRequest.numberOfDays
        leaveBalance.remainingDays -= leaveRequest.numberOfDays
        await leaveBalance.save()
      }
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

    // Send push notification to employee
    try {
      const employeeUser = await User.findOne({ employeeId: leaveRequest.employee }).select('_id')
      const approver = await Employee.findById(approvedBy).select('firstName lastName')

      if (employeeUser && approver) {
        const approverName = `${approver.firstName} ${approver.lastName}`
        const status = action === 'approve' ? 'approved' : 'rejected'
        const leaveTypeName = updatedLeave.leaveType?.name || 'Leave'

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
              leaveId: updatedLeave._id.toString(),
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

    return NextResponse.json({
      success: true,
      message: `Leave request ${action}d successfully`,
      data: updatedLeave,
    })
  } catch (error) {
    console.error('Leave action error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to process leave request' },
      { status: 500 }
    )
  }
}
