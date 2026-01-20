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

    // Parse query params for department filter
    const { searchParams } = new URL(request.url)
    const departmentFilter = searchParams.get('department')

    // Get user to find employee ID and department head info
    const userRecord = await User.findById(user._id || user.userId)
      .select('employeeId isDepartmentHead headOfDepartments')
      .populate('headOfDepartments', 'name code _id')
      .lean()

    if (!userRecord || !userRecord.employeeId) {
      // Return empty data for users without employee records
      return NextResponse.json({
        success: true,
        data: [],
        meta: {
          total: 0,
          departments: [],
          role: null,
          message: 'No employee record linked to this user'
        }
      })
    }

    // Get user role from auth
    const userRole = user.role

    let teamMembers = []
    let departments = []
    let isDepartmentHead = false
    let filteredDepartmentIds = []

    // Check if user is a department head via User.headOfDepartments (supports multiple departments)
    if (userRecord.isDepartmentHead && userRecord.headOfDepartments?.length > 0) {
      isDepartmentHead = true
      departments = userRecord.headOfDepartments
      let departmentIds = departments.map(d => d._id.toString())
      
      // Apply department filter if specified
      if (departmentFilter && departmentFilter !== 'all') {
        if (departmentIds.includes(departmentFilter)) {
          filteredDepartmentIds = [departmentFilter]
        } else {
          return NextResponse.json({ success: false, message: 'Not authorized to view this department' }, { status: 403 })
        }
      } else {
        filteredDepartmentIds = departmentIds
      }
      
      // Get all team members from filtered departments
      teamMembers = await Employee.find({
        department: { $in: filteredDepartmentIds },
        status: 'active'
      })
        .populate('designation', 'title level levelName')
        .populate('department', 'name code')
        .populate('reportingManager', 'firstName lastName employeeCode')
        .select('firstName lastName employeeCode email phone dateOfJoining designation designationLevel designationLevelName department reportingManager profilePicture skills')
        .sort({ firstName: 1 })
        .lean()

      // Also include department heads who might not be in the department directly
      const deptDetails = await Department.find({ _id: { $in: filteredDepartmentIds } })
        .populate('head', 'firstName lastName employeeCode email phone dateOfJoining designation designationLevel designationLevelName department reportingManager profilePicture skills')
        .populate('heads', 'firstName lastName employeeCode email phone dateOfJoining designation designationLevel designationLevelName department reportingManager profilePicture skills')
        .lean()

      // Collect all department head employee IDs
      const existingMemberIds = new Set(teamMembers.map(m => m._id.toString()))
      const additionalHeads = []

      for (const dept of deptDetails) {
        // Add single head if exists and not already in list
        if (dept.head && !existingMemberIds.has(dept.head._id.toString())) {
          const headEmployee = await Employee.findById(dept.head._id)
            .populate('designation', 'title level levelName')
            .populate('department', 'name code')
            .populate('reportingManager', 'firstName lastName employeeCode')
            .select('firstName lastName employeeCode email phone dateOfJoining designation designationLevel designationLevelName department reportingManager profilePicture skills')
            .lean()
          if (headEmployee && headEmployee.status !== 'inactive') {
            headEmployee.isDepartmentHead = true
            headEmployee.headOfDepartment = dept.name
            additionalHeads.push(headEmployee)
            existingMemberIds.add(headEmployee._id.toString())
          }
        }
        // Add multiple heads if exist
        if (dept.heads && dept.heads.length > 0) {
          for (const head of dept.heads) {
            if (head && !existingMemberIds.has(head._id.toString())) {
              const headEmployee = await Employee.findById(head._id)
                .populate('designation', 'title level levelName')
                .populate('department', 'name code')
                .populate('reportingManager', 'firstName lastName employeeCode')
                .select('firstName lastName employeeCode email phone dateOfJoining designation designationLevel designationLevelName department reportingManager profilePicture skills')
                .lean()
              if (headEmployee && headEmployee.status !== 'inactive') {
                headEmployee.isDepartmentHead = true
                headEmployee.headOfDepartment = dept.name
                additionalHeads.push(headEmployee)
                existingMemberIds.add(headEmployee._id.toString())
              }
            }
          }
        }
      }

      // Combine and sort
      teamMembers = [...additionalHeads, ...teamMembers].sort((a, b) => 
        (a.firstName || '').localeCompare(b.firstName || '')
      )
    } else {
      // Fallback: Check if user is a department head via Department.head or Department.heads reference
      const headDepartments = await Department.find({
        isActive: true,
        $or: [
          { head: userRecord.employeeId },
          { heads: userRecord.employeeId }
        ]
      })
        .populate('head', 'firstName lastName employeeCode email phone dateOfJoining designation designationLevel designationLevelName department reportingManager profilePicture skills')
        .populate('heads', 'firstName lastName employeeCode email phone dateOfJoining designation designationLevel designationLevelName department reportingManager profilePicture skills')
        .lean()

      if (headDepartments.length > 0) {
        isDepartmentHead = true
        departments = headDepartments
        const departmentIds = departments.map(d => d._id)
        
        // Get all team members from ALL departments user heads
        teamMembers = await Employee.find({
          department: { $in: departmentIds },
          status: 'active'
        })
          .populate('designation', 'title level levelName')
          .populate('department', 'name code')
          .populate('reportingManager', 'firstName lastName employeeCode')
          .select('firstName lastName employeeCode email phone dateOfJoining designation designationLevel designationLevelName department reportingManager profilePicture skills')
          .sort({ firstName: 1 })
          .lean()

        // Also include department heads who might not be in the department directly
        const existingMemberIds = new Set(teamMembers.map(m => m._id.toString()))
        const additionalHeads = []

        for (const dept of headDepartments) {
          // Add single head if exists and not already in list
          if (dept.head && !existingMemberIds.has(dept.head._id.toString())) {
            const headEmployee = await Employee.findById(dept.head._id)
              .populate('designation', 'title level levelName')
              .populate('department', 'name code')
              .populate('reportingManager', 'firstName lastName employeeCode')
              .select('firstName lastName employeeCode email phone dateOfJoining designation designationLevel designationLevelName department reportingManager profilePicture skills')
              .lean()
            if (headEmployee && headEmployee.status !== 'inactive') {
              headEmployee.isDepartmentHead = true
              headEmployee.headOfDepartment = dept.name
              additionalHeads.push(headEmployee)
              existingMemberIds.add(headEmployee._id.toString())
            }
          }
          // Add multiple heads if exist
          if (dept.heads && dept.heads.length > 0) {
            for (const head of dept.heads) {
              if (head && !existingMemberIds.has(head._id.toString())) {
                const headEmployee = await Employee.findById(head._id)
                  .populate('designation', 'title level levelName')
                  .populate('department', 'name code')
                  .populate('reportingManager', 'firstName lastName employeeCode')
                  .select('firstName lastName employeeCode email phone dateOfJoining designation designationLevel designationLevelName department reportingManager profilePicture skills')
                  .lean()
                if (headEmployee && headEmployee.status !== 'inactive') {
                  headEmployee.isDepartmentHead = true
                  headEmployee.headOfDepartment = dept.name
                  additionalHeads.push(headEmployee)
                  existingMemberIds.add(headEmployee._id.toString())
                }
              }
            }
          }
        }

        // Combine and sort
        teamMembers = [...additionalHeads, ...teamMembers].sort((a, b) => 
          (a.firstName || '').localeCompare(b.firstName || '')
        )
      } else if (userRole === 'department_head' || userRole === 'manager') {
        // Check user's own department as final fallback
        const userEmployee = await Employee.findById(userRecord.employeeId).select('department').lean()
        if (userEmployee?.department) {
          const dept = await Department.findById(userEmployee.department).lean()
          if (dept) {
            isDepartmentHead = true
            departments = [dept]
            
            teamMembers = await Employee.find({
              department: dept._id,
              status: 'active'
            })
              .populate('designation', 'title level levelName')
              .populate('department', 'name code')
              .populate('reportingManager', 'firstName lastName employeeCode')
              .select('firstName lastName employeeCode email phone dateOfJoining designation designationLevel designationLevelName department reportingManager profilePicture skills')
              .sort({ firstName: 1 })
              .lean()
          }
        }
      }
    }

    if (isDepartmentHead) {
      return NextResponse.json({
        success: true,
        data: teamMembers,
        meta: {
          total: teamMembers.length,
          departments: departments,
          department: departments[0] || null, // backward compatibility
          role: userRole
        }
      })
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

