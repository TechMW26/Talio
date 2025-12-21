import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import Employee from '@/models/Employee'
import { verifyToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET - Fetch all employee ratings (reviews)
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    const decoded = await verifyToken(token)
    
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    await connectDB()

    // Build query based on role
    let query = { status: 'active' }
    
    if (decoded.role === 'employee') {
      // Employees can only see their own reviews
      query._id = decoded.employeeId
    } else if (decoded.role === 'manager') {
      // Managers can see reviews for their team members
      const teamMembers = await Employee.find({ 
        reportingManager: decoded.employeeId,
        status: 'active'
      }).select('_id')
      
      const teamMemberIds = teamMembers.map(member => member._id)
      query._id = { $in: [...teamMemberIds, decoded.employeeId] }
    }
    // Admin and HR can see all employees

    // Fetch employees with reviews
    const employees = await Employee.find(query)
      .populate('reviews.reviewedBy', 'firstName lastName designation profilePicture')
      .populate('department', 'name')
      .select('firstName lastName employeeCode department designation profilePicture reviews')
      .lean()

    // Flatten reviews
    const allReviews = []
    
    employees.forEach(emp => {
      if (emp.reviews && emp.reviews.length > 0) {
        emp.reviews.forEach(review => {
          allReviews.push({
            _id: review._id || `${emp._id}-${new Date(review.createdAt).getTime()}`,
            employee: {
              _id: emp._id,
              firstName: emp.firstName,
              lastName: emp.lastName,
              employeeCode: emp.employeeCode,
              department: emp.department?.name || 'Unknown',
              designation: emp.designation,
              profilePicture: emp.profilePicture
            },
            rater: review.reviewedBy || { firstName: 'Unknown', lastName: 'User' },
            rating: review.rating || 0,
            content: review.content,
            category: review.category || 'general',
            type: review.type || 'review',
            createdAt: review.createdAt,
            ratingDate: review.createdAt
          })
        })
      }
    })

    // Sort by date (newest first)
    allReviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    return NextResponse.json({
      success: true,
      data: allReviews
    })
  } catch (error) {
    console.error('GET ratings error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to fetch ratings'
    }, { status: 500 })
  }
}

// DELETE - Delete a rating
export async function DELETE(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    const decoded = await verifyToken(token)
    
    if (!decoded || !['admin', 'hr', 'manager'].includes(decoded.role)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ success: false, message: 'Rating ID is required' }, { status: 400 })
    }

    await connectDB()

    // Find employee with this review
    const employee = await Employee.findOne({ 'reviews._id': id })

    if (!employee) {
      return NextResponse.json({ success: false, message: 'Rating not found' }, { status: 404 })
    }

    // Remove the review
    employee.reviews = employee.reviews.filter(r => r._id.toString() !== id)
    await employee.save()

    return NextResponse.json({
      success: true,
      message: 'Rating deleted successfully'
    })
  } catch (error) {
    console.error('DELETE rating error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to delete rating'
    }, { status: 500 })
  }
}
