import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
// GET - Fetch employee reviews/remarks
export async function GET(request, { params }) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    const decoded = await verifyToken(token)
    
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Employee } = models

    const { id } = params
    
    // Check if user has permission to view reviews
    if (decoded.role === 'employee' && decoded.employeeId !== id) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    const employee = await Employee.findById(id)
      .populate('reviews.reviewedBy', 'firstName lastName designation')
      .select('reviews')
      .lean()

    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Sort reviews by date (newest first)
    const sortedReviews = (employee.reviews || []).sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    )

    return NextResponse.json({
      success: true,
      data: sortedReviews
    })

  } catch (error) {
    console.error('Get employee reviews error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Add review/remark to employee
export async function POST(request, { params }) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    const decoded = await verifyToken(token)
    
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Only managers, hr, and admin can add reviews
    if (!['admin', 'hr', 'manager'].includes(decoded.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    const { id } = params
    const body = await request.json()
    const { type, content, rating, category } = body

    // Validate required fields
    if (!type || !content) {
      return NextResponse.json(
        { success: false, message: 'Type and content are required' },
        { status: 400 }
      )
    }

    // Validate type
    const validTypes = ['review', 'remark', 'feedback', 'warning', 'appreciation']
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { success: false, message: 'Invalid review type' },
        { status: 400 }
      )
    }

    // Find employee
    const employee = await Employee.findById(id)
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Add review to employee
    const newReview = {
      type,
      content,
      rating: rating || null,
      category: category || 'general',
      reviewedBy: decoded.employeeId,
      createdAt: new Date()
    }

    employee.reviews.push(newReview)
    await employee.save()

    // Populate the reviewer info
    await employee.populate('reviews.reviewedBy', 'firstName lastName designation')

    // Get the newly added review
    const addedReview = employee.reviews[employee.reviews.length - 1]

    return NextResponse.json({
      success: true,
      message: 'Review added successfully',
      data: addedReview
    }, { status: 201 })

  } catch (error) {
    console.error('Add employee review error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error', error: error.message },
      { status: 500 }
    )
  }
}

// DELETE - Delete a review/remark
export async function DELETE(request, { params }) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    const decoded = await verifyToken(token)
    
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Only admin and hr can delete reviews
    if (!['admin', 'hr'].includes(decoded.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    const { id } = params
    const { searchParams } = new URL(request.url)
    const reviewId = searchParams.get('reviewId')

    if (!reviewId) {
      return NextResponse.json(
        { success: false, message: 'Review ID is required' },
        { status: 400 }
      )
    }

    // Find employee and remove review
    const employee = await Employee.findById(id)
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    employee.reviews = employee.reviews.filter(review => review._id.toString() !== reviewId)
    await employee.save()

    return NextResponse.json({
      success: true,
      message: 'Review deleted successfully'
    })

  } catch (error) {
    console.error('Delete employee review error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}

