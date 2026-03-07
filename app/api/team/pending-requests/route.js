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

    // Get user's employee ID and department head/manager info
    const userRecord = await User.findById(user._id || user.userId)
      .select('employeeId isDepartmentHead headOfDepartments isDepartmentManager departmentManagerOf')
      .lean()
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

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
      departments = await Department.find({
        isActive: true,
        $or: [
          { head: userRecord.employeeId },
          { heads: userRecord.employeeId },
          { departmentManager: userRecord.employeeId },
          { departmentManagers: userRecord.employeeId }
        ]
      }).lean()
      departmentIds = departments.map(d => d._id.toString())
    }

    if (departmentIds.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'You are not a department head or manager'
      }, { status: 403 })
    }

    // Get all team members (employees in ALL departments)
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
      .populate('employee', 'firstName lastName employeeCode profilePicture department')
      .populate({
        path: 'employee',
        populate: { path: 'department', select: 'name code' }
      })
      .populate('leaveType', 'name')
      .sort({ createdAt: -1 })
      .limit(10)

    return NextResponse.json({
      success: true,
      data: {
        departments: departments.map(d => ({ id: d._id, name: d.name, code: d.code })),
        department: departments[0] ? { id: departments[0]._id, name: departments[0].name, code: departments[0].code } : null, // backward compatibility
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

