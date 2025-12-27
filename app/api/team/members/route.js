import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

export const dynamic = 'force-dynamic'


// GET - Fetch all team members for department head
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'Department', 'Designation', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Employee, Department, Designation, User } = models

    // Get user to find employee ID
    const userRecord = await User.findById(user._id || user.userId).select('employeeId').lean()

    if (!userRecord || !userRecord.employeeId) {
      // Return empty data for users without employee records
      return NextResponse.json({
        success: true,
        data: [],
        meta: {
          total: 0,
          department: null,
          role: null,
          message: 'No employee record linked to this user'
        }
      })
    }

    // Get user role from auth
    const userRole = user.role

    let teamMembers = []
    let department = null
    let isDepartmentHead = false

    // Check if user is a department head (by Department.head reference OR by role)
    department = await Department.findOne({
      head: userRecord.employeeId,
      isActive: true
    }).lean()

    // Also check if user has department_head role
    if (!department && (userRole === 'department_head' || userRole === 'manager')) {
      // Get the user's department
      const userEmployee = await Employee.findById(userRecord.employeeId).select('department').lean()
      if (userEmployee?.department) {
        department = await Department.findById(userEmployee.department).lean()
      }
    }

    if (department) {
      isDepartmentHead = true
      // User is department head - get all team members in the department
      teamMembers = await Employee.find({
        department: department._id,
        status: 'active'
      })
        .populate('designation', 'title level levelName')
        .populate('reportingManager', 'firstName lastName employeeCode')
        .select('firstName lastName employeeCode email phone dateOfJoining designation designationLevel designationLevelName reportingManager profilePicture skills')
        .sort({ firstName: 1 })
        .lean()
    } else if (userRole === 'manager') {
      // User is manager - get direct reports
      teamMembers = await Employee.find({
        reportingManager: userRecord.employeeId,
        status: 'active'
      })
        .populate('designation', 'title level levelName')
        .populate('department', 'name')
        .select('firstName lastName employeeCode email phone dateOfJoining designation designationLevel designationLevelName department profilePicture skills')
        .sort({ firstName: 1 })
        .lean()

      // Get manager's department for context
      const managerEmployee = await Employee.findById(userRecord.employeeId).select('department').populate('department', 'name').lean()
      department = managerEmployee?.department
    } else {
      return NextResponse.json(
        { success: false, message: 'Access denied. Only department heads and managers can view team members.' },
        { status: 403 }
      )
    }

    return NextResponse.json({
      success: true,
      data: teamMembers,
      meta: {
        total: teamMembers.length,
        department: department,
        role: userRole
      }
    })

  } catch (error) {
    console.error('Error fetching team members:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch team members', error: error.message },
      { status: 500 }
    )
  }
}

