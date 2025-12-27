import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
export const dynamic = 'force-dynamic'


// GET - Fetch all pending requests for department head
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Department', 'Employee', 'Leave', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Department, Employee, Leave, User } = models

    // Get user's employee ID
    const userRecord = await User.findById(user._id || user.userId).select('employeeId')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Check if user is a department head
    const department = await Department.findOne({ 
      head: userRecord.employeeId,
      isActive: true 
    })

    if (!department) {
      return NextResponse.json({ 
        success: false, 
        message: 'You are not a department head' 
      }, { status: 403 })
    }

    // Get all team members (employees in the department)
    const teamMembers = await Employee.find({ 
      department: department._id,
      status: 'active'
    }).select('_id')

    const teamMemberIds = teamMembers.map(emp => emp._id)

    // Get pending leave requests
    const pendingLeaves = await Leave.find({
      employee: { $in: teamMemberIds },
      status: 'pending'
    })
      .populate('employee', 'firstName lastName employeeCode profilePicture')
      .populate('leaveType', 'name')
      .sort({ createdAt: -1 })
      .limit(10)

    return NextResponse.json({
      success: true,
      data: {
        department: {
          id: department._id,
          name: department.name,
          code: department.code
        },
        teamMembersCount: teamMemberIds.length,
        pendingLeaves: pendingLeaves.length,
        recentLeaves: pendingLeaves.slice(0, 5)
      }
    })
  } catch (error) {
    console.error('Get pending requests error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

