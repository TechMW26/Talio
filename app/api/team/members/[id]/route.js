import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

// GET - Get individual team member details
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'Department', 'Designation', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Employee, Department, Designation, User } = models

    const { id } = params

    // Get user to find employee ID and department head info
    const userRecord = await User.findById(user._id || user.userId)
      .select('employeeId isDepartmentHead headOfDepartments')
      .lean()
    
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }

    // Check if user is a department head - support multiple departments
    let departmentIds = []

    // First check User.headOfDepartments (supports multiple departments)
    if (userRecord?.isDepartmentHead && userRecord?.headOfDepartments?.length > 0) {
      departmentIds = userRecord.headOfDepartments.map(d => d.toString())
    }

    // Fallback: Check Department.head or Department.heads
    if (departmentIds.length === 0) {
      const headDepartments = await Department.find({ 
        isActive: true,
        $or: [
          { head: userRecord.employeeId },
          { heads: userRecord.employeeId }
        ]
      }).select('_id').lean()
      departmentIds = headDepartments.map(d => d._id.toString())
    }

    if (departmentIds.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Access denied. Only department heads can view team member details.' },
        { status: 403 }
      )
    }

    // Get team member details
    const teamMember = await Employee.findById(id)
      .populate('designation', 'title level levelName')
      .populate('reportingManager', 'firstName lastName employeeCode email')
      .populate('department', 'name code')
      .lean()

    if (!teamMember) {
      return NextResponse.json(
        { success: false, message: 'Team member not found' },
        { status: 404 }
      )
    }

    // Verify team member is in one of the departments user heads
    const memberDeptId = teamMember.department?._id?.toString()
    if (!departmentIds.includes(memberDeptId)) {
      return NextResponse.json(
        { success: false, message: 'Access denied. This employee is not in your department.' },
        { status: 403 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        employee: teamMember
      }
    })

  } catch (error) {
    console.error('Error fetching team member details:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch team member details', error: error.message },
      { status: 500 }
    )
  }
}

// POST - Add review/rating/remark for team member
export async function POST(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'Department', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Employee, Department, User } = models

    const { id } = params

    const body = await request.json()
    const { type, content, rating, category } = body

    if (!type || !content) {
      return NextResponse.json(
        { success: false, message: 'Type and content are required' },
        { status: 400 }
      )
    }

    // Get user to find employee ID and department head info
    const userRecord = await User.findById(user._id || user.userId)
      .select('employeeId isDepartmentHead headOfDepartments')
      .lean()
    
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }

    // Check if user is a department head - support multiple departments
    let departmentIds = []

    // First check User.headOfDepartments (supports multiple departments)
    if (userRecord?.isDepartmentHead && userRecord?.headOfDepartments?.length > 0) {
      departmentIds = userRecord.headOfDepartments.map(d => d.toString())
    }

    // Fallback: Check Department.head or Department.heads
    if (departmentIds.length === 0) {
      const headDepartments = await Department.find({ 
        isActive: true,
        $or: [
          { head: userRecord.employeeId },
          { heads: userRecord.employeeId }
        ]
      }).select('_id').lean()
      departmentIds = headDepartments.map(d => d._id.toString())
    }

    if (departmentIds.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Access denied. Only department heads can add reviews.' },
        { status: 403 }
      )
    }

    // Get team member
    const teamMember = await Employee.findById(id)

    if (!teamMember) {
      return NextResponse.json(
        { success: false, message: 'Team member not found' },
        { status: 404 }
      )
    }

    // Verify team member is in one of the departments user heads
    const memberDeptId = teamMember.department?.toString()
    if (!departmentIds.includes(memberDeptId)) {
      return NextResponse.json(
        { success: false, message: 'Access denied. This employee is not in your department.' },
        { status: 403 }
      )
    }

    // Initialize reviews array if it doesn't exist
    if (!teamMember.reviews) {
      teamMember.reviews = []
    }

    // Add review/remark
    const review = {
      type: type, // 'review', 'remark', 'feedback', 'warning', 'appreciation'
      content: content,
      rating: rating || null, // 1-5 rating (optional)
      category: category || 'general', // 'performance', 'behavior', 'skills', 'general'
      reviewedBy: userRecord.employeeId,
      createdAt: new Date()
    }

    teamMember.reviews.push(review)
    await teamMember.save()

    return NextResponse.json({
      success: true,
      message: `${type.charAt(0).toUpperCase() + type.slice(1)} added successfully`,
      data: review
    })

  } catch (error) {
    console.error('Error adding review:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to add review', error: error.message },
      { status: 500 }
    )
  }
}

