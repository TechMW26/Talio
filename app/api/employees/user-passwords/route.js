import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

/**
 * GET - Fetch all users with their current passwords
 * Only admin and HR can access this
 * Passwords are fetched directly from User.plaintextPassword field
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Employee } = models
    
    // Only admin and HR can access this
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page')) || 1
    const limit = parseInt(searchParams.get('limit')) || 50
    const search = searchParams.get('search') || ''
    const filter = searchParams.get('filter') || 'all' // 'all', 'with-password', 'without-password'
    
    const skip = (page - 1) * limit

    // Build search query
    let matchStage = {}
    if (search) {
      matchStage.$or = [
        { email: { $regex: search, $options: 'i' } },
      ]
    }

    // Get all users with plaintextPassword field directly from DB
    // Use projection object to explicitly include the select:false field
    const users = await User.find(matchStage, {
      email: 1,
      role: 1,
      isActive: 1,
      forcePasswordChange: 1,
      createdAt: 1,
      updatedAt: 1,
      employeeId: 1,
      plaintextPassword: 1,  // This overrides schema's select: false
    })
      .populate({
        path: 'employeeId',
        select: 'firstName lastName employeeCode department designation',
        populate: [
          { path: 'department', select: 'name' },
          { path: 'designation', select: 'title' }
        ]
      })
      .sort({ createdAt: -1 })
      .lean()

    // Map results
    let results = users.map(u => {
      const employee = u.employeeId
      
      return {
        _id: u._id,
        email: u.email,
        firstName: employee?.firstName || '',
        lastName: employee?.lastName || '',
        employeeCode: employee?.employeeCode || '',
        department: employee?.department?.name || '',
        designation: employee?.designation?.title || '',
        role: u.role,
        isActive: u.isActive,
        password: u.plaintextPassword || null,
        forcePasswordChange: u.forcePasswordChange,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      }
    })

    // Filter by name if search includes name
    if (search) {
      const searchLower = search.toLowerCase()
      results = results.filter(r => 
        r.email?.toLowerCase().includes(searchLower) ||
        r.firstName?.toLowerCase().includes(searchLower) ||
        r.lastName?.toLowerCase().includes(searchLower) ||
        r.employeeCode?.toLowerCase().includes(searchLower)
      )
    }

    // Apply password filter
    if (filter === 'with-password') {
      results = results.filter(r => r.password)
    } else if (filter === 'without-password') {
      results = results.filter(r => !r.password)
    }

    const total = results.length
    const paginatedResults = results.slice(skip, skip + limit)

    // Stats
    const withPassword = results.filter(r => r.password).length
    const withoutPassword = results.filter(r => !r.password).length

    return NextResponse.json({
      success: true,
      data: paginatedResults,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      stats: {
        total: results.length,
        withPassword,
        withoutPassword,
      }
    })
  } catch (error) {
    console.error('Get user passwords error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to fetch user passwords' },
      { status: 500 }
    )
  }
}
