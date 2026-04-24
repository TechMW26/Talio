import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { logActivity } from '@/lib/activityLogger'
import { emitLeaveUpdate } from '@/lib/realtimeEvents'
import { buildDirectReportsFilter } from '@/lib/teamScope'

// GET - List leave requests
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Leave', 'LeaveBalance', 'LeaveType', 'User', 'Employee', 'Department'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Leave, LeaveBalance, LeaveType, User, Employee, Department } = models

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const status = searchParams.get('status')

    // Get user record and role
    const userRecord = await User.findById(user._id || user.userId)
      .select('employeeId role isDepartmentHead headOfDepartments')
      .lean()
    
    const userRole = userRecord?.role || user.role
    const userEmployeeId = userRecord?.employeeId

    const query = {}

    // If specific employeeId is requested, user can only see their own leaves or those they can approve
    if (employeeId) {
      query.employee = employeeId
    }

    if (status) {
      query.status = status
    }

    // Role-based filtering for pending approvals
    // When fetching pending leaves without a specific employeeId, scope based on role
    if (status === 'pending' && !employeeId) {
      // Admin sees all pending leaves
      if (userRole === 'admin') {
        // No additional filter - admin sees everything
      }
      // HR users should ONLY see approvals if they're a department head (for their department)
      // Regular HR employees should NOT see pending approvals - their dept head handles their leaves
      else if (userRole === 'hr') {
        if (userRecord?.isDepartmentHead && userRecord?.headOfDepartments?.length > 0) {
          // HR who is dept head - only see their department's leaves
          const deptEmployees = await Employee.find({ 
            department: { $in: userRecord.headOfDepartments },
            _id: { $ne: userEmployeeId } // Exclude own leaves
          }).select('_id').lean()
          const deptEmployeeIds = deptEmployees.map(e => e._id)
          query.employee = { $in: deptEmployeeIds }
        } else {
          // Regular HR (not dept head) - should not see pending approvals
          // Return empty - they can only see their own leaves via employeeId filter
          return NextResponse.json({
            success: true,
            data: [],
            message: 'Only your department head can approve leave requests'
          })
        }
      }
      // Department heads see their department's leaves
      else if (userRole === 'department_head' || userRecord?.isDepartmentHead) {
        let deptIds = []
        
        // Check headOfDepartments on User model
        if (userRecord?.headOfDepartments?.length > 0) {
          deptIds = userRecord.headOfDepartments
        } else if (userEmployeeId) {
          // Fallback to Department.head or Department.heads
          const managedDepts = await Department.find({
            $or: [
              { head: userEmployeeId },
              { heads: userEmployeeId }
            ]
          }).select('_id').lean()
          deptIds = managedDepts.map(d => d._id)
        }
        
        if (deptIds.length > 0) {
          const deptEmployees = await Employee.find({ 
            department: { $in: deptIds },
            _id: { $ne: userEmployeeId } // Exclude own leaves
          }).select('_id').lean()
          const deptEmployeeIds = deptEmployees.map(e => e._id)
          query.employee = { $in: deptEmployeeIds }
        } else {
          // Not actually a dept head - return empty
          return NextResponse.json({
            success: true,
            data: [],
            message: 'No department assigned'
          })
        }
      }
      // Managers see their direct reports' leaves
      else if (userRole === 'manager' && userEmployeeId) {
        const directReports = await Employee.find({
          ...buildDirectReportsFilter(userEmployeeId),
          _id: { $ne: userEmployeeId }
        }).select('_id').lean()
        const reportIds = directReports.map(e => e._id)
        query.employee = { $in: reportIds }
      }
      // Regular employees should not see pending approvals
      else {
        return NextResponse.json({
          success: true,
          data: [],
          message: 'Only department heads and admins can approve leave requests'
        })
      }
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

