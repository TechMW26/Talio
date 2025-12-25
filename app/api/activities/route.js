import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'

// GET - Fetch activities
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Activity', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Activity, User } = models

    const currentUser = await User.findById(decoded.userId).select('employeeId role')
    const employeeId = currentUser?.employeeId

    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date') // Format: YYYY-MM-DD
    const limit = parseInt(searchParams.get('limit')) || 50
    const type = searchParams.get('type')

    // Build query
    const query = { employee: employeeId }

    // Filter by date (today by default)
    if (date) {
      const startOfDay = new Date(date)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(date)
      endOfDay.setHours(23, 59, 59, 999)
      
      query.createdAt = {
        $gte: startOfDay,
        $lte: endOfDay
      }
    } else {
      // Default to today
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const endOfToday = new Date()
      endOfToday.setHours(23, 59, 59, 999)
      
      query.createdAt = {
        $gte: today,
        $lte: endOfToday
      }
    }

    // Filter by type
    if (type) {
      query.type = type
    }

    const activities = await Activity.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()

    return NextResponse.json({
      success: true,
      data: activities,
      count: activities.length
    })

  } catch (error) {
    console.error('Get activities error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch activities' },
      { status: 500 }
    )
  }
}

// POST - Create activity (for manual logging)
export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    const currentUser = await User.findById(decoded.userId).select('employeeId')
    const employeeId = currentUser?.employeeId

    const body = await request.json()
    const { type, action, details, metadata, relatedModel, relatedId } = body

    const activity = await Activity.create({
      employee: employeeId,
      type,
      action,
      details,
      metadata,
      relatedModel,
      relatedId,
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
      userAgent: request.headers.get('user-agent')
    })

    return NextResponse.json({
      success: true,
      data: activity
    }, { status: 201 })

  } catch (error) {
    console.error('Create activity error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to create activity' },
      { status: 500 }
    )
  }
}

