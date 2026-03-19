import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET - Fetch all employee ratings (reviews)
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'Team'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Employee, Team } = models

    const { searchParams } = new URL(request.url)
    const department = searchParams.get('department')
    const departments = searchParams.get('departments') // Comma-separated list
    const teamFilter = searchParams.get('team')

    // Build query based on role
    let query = { status: 'active' }
    
    // Get employeeId - could be object or string
    const employeeId = user.employeeId?._id || user.employeeId
    
    if (user.role === 'employee') {
      // Employees can only see their own reviews
      query._id = employeeId
    } else if (user.role === 'manager') {
      // Managers can see reviews for their team members
      const teamMembers = await Employee.find({ 
        reportingManager: employeeId,
        status: 'active'
      }).select('_id')
      
      const teamMemberIds = teamMembers.map(member => member._id)
      query._id = { $in: [...teamMemberIds, employeeId] }
    }
    // Admin and HR can see all employees
    
    // Apply department filter
    if (departments) {
      const deptIds = departments.split(',').filter(id => id.trim())
      if (deptIds.length > 0) {
        query.department = { $in: deptIds }
      }
    } else if (department && department !== 'all') {
      query.department = department
    }

    // Apply team filter
    if (teamFilter && teamFilter !== 'all' && Team) {
      const team = await Team.findById(teamFilter).select('members teamLeaders').lean()
      if (team) {
        const teamMemberIds = [
          ...(team.members || []).map(id => id),
          ...(team.teamLeaders || []).map(id => id)
        ]
        query._id = query._id ? { $in: teamMemberIds.filter(id => {
          const idStr = id.toString()
          if (query._id.$in) return query._id.$in.some(qid => qid.toString() === idStr)
          return query._id.toString() === idStr
        })} : { $in: teamMemberIds }
      }
    }

    // Fetch employees with reviews
    const employees = await Employee.find(query)
      .populate({
        path: 'reviews.reviewedBy',
        select: 'firstName lastName designation profilePicture',
        options: { strictPopulate: false }
      })
      .populate({
        path: 'department',
        select: 'name',
        options: { strictPopulate: false }
      })
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
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Employee } = models
    
    if (!['admin', 'hr', 'manager'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ success: false, message: 'Rating ID is required' }, { status: 400 })
    }

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
