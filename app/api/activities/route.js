import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'

// GET - Fetch activities
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Activity', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Activity, User } = models

    const userId = user._id || user.userId
    if (!userId) {
      return NextResponse.json({ success: false, message: 'User ID not found' }, { status: 400 })
    }

    const currentUser = await User.findById(userId).select('employeeId role')
    const employeeId = currentUser?.employeeId

    if (!employeeId) {
      return NextResponse.json({
        success: true,
        data: [],
        count: 0,
        message: 'No employee profile linked'
      })
    }

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
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Activity', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Activity, User } = models

    const userId = user._id || user.userId
    if (!userId) {
      return NextResponse.json({ success: false, message: 'User ID not found' }, { status: 400 })
    }

    const currentUser = await User.findById(userId).select('employeeId')
    const employeeId = currentUser?.employeeId

    if (!employeeId) {
      return NextResponse.json({ success: false, message: 'No employee profile linked' }, { status: 400 })
    }

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

