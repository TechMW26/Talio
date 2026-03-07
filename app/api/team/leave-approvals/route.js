import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { logActivity } from '@/lib/activityLogger'

// GET - Fetch all pending leave requests for department
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Department', 'Employee', 'Leave', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Department, Employee, Leave, User } = models

    // Get user's employee ID from auth
    const employeeId = user?.employeeId?._id || user?.employeeId
    if (!employeeId) {
      // Return empty data for users without employee records
      return NextResponse.json({
        success: true,
        data: [],
        message: 'No employee record linked to this user'
      })
    }

    // Get user record to check headOfDepartments AND departmentManagerOf
    const userRecord = await User.findById(user._id || user.userId)
      .select('isDepartmentHead headOfDepartments isDepartmentManager departmentManagerOf')
      .lean()

    // Check if user is a department head or manager - support multiple departments
    let departmentIds = []
    let departments = []

    // First check User.headOfDepartments (supports multiple departments)
    if (userRecord?.isDepartmentHead && userRecord?.headOfDepartments?.length > 0) {
      departmentIds = userRecord.headOfDepartments.map(d => d.toString())
      departments = await Department.find({ _id: { $in: departmentIds }, isActive: true }).lean()
    }

    // Also check departmentManagerOf
    if (userRecord?.isDepartmentManager && userRecord?.departmentManagerOf?.length > 0) {
      const mgrDeptIds = userRecord.departmentManagerOf.map(d => d.toString())
      const mgrDepts = await Department.find({ _id: { $in: mgrDeptIds }, isActive: true }).lean()
      for (const md of mgrDepts) {
        if (!departmentIds.includes(md._id.toString())) {
          departmentIds.push(md._id.toString())
          departments.push(md)
        }
      }
    }

    // Fallback: Check Department.head, Department.heads, or Department.departmentManagers
    if (departmentIds.length === 0) {
      const headDepartments = await Department.find({
        isActive: true,
        $or: [
          { head: employeeId },
          { heads: employeeId },
          { departmentManager: employeeId },
          { departmentManagers: employeeId }
        ]
      }).lean()
      departmentIds = headDepartments.map(d => d._id.toString())
      departments = headDepartments
    }

    if (departmentIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        message: 'You are not a department head or manager'
      })
    }

    // Get all team members from ALL departments
    const teamMembers = await Employee.find({
      department: { $in: departmentIds },
      status: 'active'
    }).select('_id')

    const teamMemberIds = teamMembers.map(emp => emp._id)

    // Get pending leave requests
    const pendingLeaves = await Leave.find({
      employee: { $in: teamMemberIds },
      status: 'pending'
    })
      .populate('employee', 'firstName lastName employeeCode profilePicture email designation department')
      .populate({
        path: 'employee',
        populate: [
          { path: 'designation', select: 'title' },
          { path: 'department', select: 'name code' }
        ]
      })
      .populate('leaveType', 'name code')
      .sort({ createdAt: -1 })

    return NextResponse.json({
      success: true,
      data: pendingLeaves,
      meta: {
        departments: departments,
        totalDepartments: departments.length
      }
    })
  } catch (error) {
    console.error('Get leave approvals error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// POST - Approve or reject leave request
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Department', 'Employee', 'Leave', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Department, Employee, Leave, User } = models

    // Get user's employee ID from auth
    const employeeId = user?.employeeId?._id || user?.employeeId
    if (!employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Get user record to check headOfDepartments and departmentManagerOf
    const userRecord = await User.findById(user._id || user.userId)
      .select('isDepartmentHead headOfDepartments isDepartmentManager departmentManagerOf')
      .lean()

    // Check if user is a department head or manager - support multiple departments
    let departmentIds = []

    // First check User.headOfDepartments (supports multiple departments)
    if (userRecord?.isDepartmentHead && userRecord?.headOfDepartments?.length > 0) {
      departmentIds = userRecord.headOfDepartments.map(d => d.toString())
    }

    // Also check departmentManagerOf
    if (userRecord?.isDepartmentManager && userRecord?.departmentManagerOf?.length > 0) {
      const mgrDeptIds = userRecord.departmentManagerOf.map(d => d.toString())
      for (const id of mgrDeptIds) {
        if (!departmentIds.includes(id)) departmentIds.push(id)
      }
    }

    // Fallback: Check Department.head, Department.heads, or Department.departmentManagers
    if (departmentIds.length === 0) {
      const headDepartments = await Department.find({
        isActive: true,
        $or: [
          { head: employeeId },
          { heads: employeeId },
          { departmentManager: employeeId },
          { departmentManagers: employeeId }
        ]
      }).select('_id').lean()
      departmentIds = headDepartments.map(d => d._id.toString())
    }

    if (departmentIds.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'You are not a department head or manager'
      }, { status: 403 })
    }

    const body = await request.json()
    const { leaveId, action, comments } = body

    if (!leaveId || !action) {
      return NextResponse.json({
        success: false,
        message: 'Leave ID and action are required'
      }, { status: 400 })
    }

    if (!['approved', 'rejected'].includes(action)) {
      return NextResponse.json({
        success: false,
        message: 'Invalid action. Must be "approved" or "rejected"'
      }, { status: 400 })
    }

    // Get the leave request
    const leave = await Leave.findById(leaveId).populate('employee', 'department')

    if (!leave) {
      return NextResponse.json({
        success: false,
        message: 'Leave request not found'
      }, { status: 404 })
    }

    // Verify the employee belongs to one of the departments the user heads
    const leaveDeptId = leave.employee.department?.toString()
    if (!departmentIds.includes(leaveDeptId)) {
      return NextResponse.json({
        success: false,
        message: 'This leave request is not from your department'
      }, { status: 403 })
    }

    // Update leave status
    leave.status = action
    leave.approvedBy = employeeId
    leave.approvedAt = new Date()

    // Update approval workflow
    if (leave.approvalWorkflow && leave.approvalWorkflow.length > 0) {
      const currentLevel = leave.currentApprovalLevel || 0
      if (leave.approvalWorkflow[currentLevel]) {
        leave.approvalWorkflow[currentLevel].status = action
        leave.approvalWorkflow[currentLevel].approvedAt = new Date()
        leave.approvalWorkflow[currentLevel].comments = comments || ''
      }
    }

    await leave.save()

    const updatedLeave = await Leave.findById(leaveId)
      .populate('employee', 'firstName lastName employeeCode profilePicture email')
      .populate('leaveType', 'name code')
      .populate('approvedBy', 'firstName lastName')

    // Log activity for leave approval/rejection
    await logActivity({
      employeeId: employeeId,
      type: action === 'approved' ? 'leave_approve' : 'leave_reject',
      action: action === 'approved' ? 'Approved leave request' : 'Rejected leave request',
      details: `${updatedLeave.employee.firstName} ${updatedLeave.employee.lastName}'s leave request`,
      metadata: {
        leaveId: leave._id,
        employeeId: leave.employee._id
      },
      relatedModel: 'Leave',
      relatedId: leave._id
    })

    return NextResponse.json({
      success: true,
      data: updatedLeave,
      message: `Leave request ${action} successfully`
    })
  } catch (error) {
    console.error('Approve/reject leave error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

