import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'

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

    // Verify authentication
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json(
        { success: false, message: 'Invalid token' },
        { status: 401 }
      )
    }

    // Get user to find employee ID
    const user = await User.findById(decoded.userId).select('employeeId').lean()
    
    if (!user || !user.employeeId) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }

    // Check if user is a department head
    const department = await Department.findOne({ 
      head: user.employeeId,
      isActive: true 
    }).lean()

    if (!department) {
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

    // Verify team member is in the same department
    if (teamMember.department._id.toString() !== department._id.toString()) {
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
    const { id } = params

    // Verify authentication
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json(
        { success: false, message: 'Invalid token' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { type, content, rating, category } = body

    if (!type || !content) {
      return NextResponse.json(
        { success: false, message: 'Type and content are required' },
        { status: 400 }
      )
    }

    // Get user to find employee ID
    const user = await User.findById(decoded.userId).select('employeeId').lean()
    
    if (!user || !user.employeeId) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }

    // Check if user is a department head
    const department = await Department.findOne({ 
      head: user.employeeId,
      isActive: true 
    }).lean()

    if (!department) {
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

    // Verify team member is in the same department
    if (teamMember.department.toString() !== department._id.toString()) {
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
      reviewedBy: user.employeeId,
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

