import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { logActivity } from '@/lib/activityLogger'
import { emitLeaveUpdate } from '@/lib/realtimeEvents'

// GET - List leave requests
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Leave', 'LeaveBalance', 'LeaveType', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Leave, LeaveBalance, LeaveType, User } = models

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const status = searchParams.get('status')

    const query = {}

    if (employeeId) {
      query.employee = employeeId
    }

    if (status) {
      query.status = status
    }

    const leaves = await Leave.find(query)
      .populate('employee', 'firstName lastName employeeCode')
      .populate('leaveType', 'name')
      .populate('approvedBy', 'firstName lastName')
      .sort({ createdAt: -1 })

    return NextResponse.json({
      success: true,
      data: leaves,
    })
  } catch (error) {
    console.error('Get leaves error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch leaves' },
      { status: 500 }
    )
  }
}

// POST - Apply for leave
export async function POST(request) {
  try {
    const data = await request.json()

    // Calculate number of days
    const startDate = new Date(data.startDate)
    const endDate = new Date(data.endDate)
    const diffTime = Math.abs(endDate - startDate)
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1

    // Check leave balance
    const leaveBalance = await LeaveBalance.findOne({
      employee: data.employee,
      leaveType: data.leaveType,
    })

    if (!leaveBalance || leaveBalance.available < diffDays) {
      return NextResponse.json(
        { success: false, message: 'Insufficient leave balance' },
        { status: 400 }
      )
    }

    // Create leave request
    const leave = await Leave.create({
      ...data,
      numberOfDays: diffDays,
      status: 'pending',
    })

    const populatedLeave = await Leave.findById(leave._id)
      .populate('employee', 'firstName lastName employeeCode')
      .populate('leaveType', 'name')

    // Log activity for leave application
    await logActivity({
      employeeId: data.employee,
      type: 'leave_apply',
      action: 'Applied for leave',
      details: `${diffDays} day(s) leave from ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`,
      metadata: {
        leaveType: data.leaveType,
        numberOfDays: diffDays
      },
      relatedModel: 'Leave',
      relatedId: leave._id
    })

    // Emit real-time leave update to admins/HR/managers
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
          reason: leave.reason
        },
        targetUserIds,
        { isNew: true, action: 'request' }
      )
    } catch (emitError) {
      console.error('Failed to emit leave update:', emitError)
    }

    return NextResponse.json({
      success: true,
      message: 'Leave request submitted successfully',
      data: populatedLeave,
    }, { status: 201 })
  } catch (error) {
    console.error('Apply leave error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to apply for leave' },
      { status: 500 }
    )
  }
}

