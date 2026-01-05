import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

/**
 * Toggle guest access for a meeting
 * POST /api/meetings/[id]/guest-access
 */
export async function POST(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Meeting', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { id } = await params
    const body = await request.json()
    const { enabled } = body

    // Find the meeting
    const meeting = await models.Meeting.findById(id)
    
    if (!meeting) {
      return NextResponse.json(
        { success: false, message: 'Meeting not found' },
        { status: 404 }
      )
    }

    // Get current user's employee record
    const userRecord = await models.User.findById(user._id || user.userId).select('employeeId').lean()
    
    let employee = null
    if (userRecord?.employeeId) {
      employee = await models.Employee.findById(userRecord.employeeId).lean()
    }
    
    // If user doesn't have employeeId directly, try to find employee by userId
    if (!employee) {
      employee = await models.Employee.findOne({ userId: user._id || user.userId }).lean()
    }

    // Check if user is the organizer or admin
    const isOrganizer = meeting.organizer?.toString() === employee?._id?.toString()
    const isAdmin = ['admin', 'hr'].includes(user.role)

    if (!isOrganizer && !isAdmin) {
      return NextResponse.json(
        { success: false, message: 'Only the meeting organizer can manage guest access' },
        { status: 403 }
      )
    }

    // Only online meetings can have guest access
    if (meeting.type !== 'online') {
      return NextResponse.json(
        { success: false, message: 'Guest access is only available for online meetings' },
        { status: 400 }
      )
    }

    // Initialize guestAccess if not exists
    if (!meeting.guestAccess) {
      meeting.guestAccess = {
        enabled: false,
        guests: []
      }
    }

    // Toggle guest access
    meeting.guestAccess.enabled = enabled

    // Generate guest link if enabling and doesn't exist
    // Include tenant database name in the link for multi-tenant support
    if (enabled && !meeting.guestAccess.guestLink) {
      const tenantId = auth.tenant.databaseName.replace('talio_', '') // Remove prefix for shorter URLs
      meeting.guestAccess.guestLink = `${tenantId}-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`
      meeting.guestAccess.guestLinkCreatedAt = new Date()
      meeting.guestAccess.tenantDatabase = auth.tenant.databaseName // Store full database name
    }

    await meeting.save()

    // Generate full guest URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const guestUrl = enabled ? `${baseUrl}/join/${meeting.guestAccess.guestLink}` : null

    return NextResponse.json({
      success: true,
      data: {
        guestAccessEnabled: meeting.guestAccess.enabled,
        guestLink: meeting.guestAccess.guestLink,
        guestUrl
      },
      message: enabled ? 'Guest access enabled' : 'Guest access disabled'
    })

  } catch (error) {
    console.error('Error toggling guest access:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to update guest access settings' },
      { status: 500 }
    )
  }
}

// GET - Get guest access status
export async function GET(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Meeting'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { models } = auth
    const { id } = await params

    const meeting = await models.Meeting.findById(id).select('guestAccess type')
    
    if (!meeting) {
      return NextResponse.json(
        { success: false, message: 'Meeting not found' },
        { status: 404 }
      )
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const guestUrl = meeting.guestAccess?.enabled && meeting.guestAccess?.guestLink 
      ? `${baseUrl}/join/${meeting.guestAccess.guestLink}` 
      : null

    return NextResponse.json({
      success: true,
      data: {
        guestAccessEnabled: meeting.guestAccess?.enabled || false,
        guestLink: meeting.guestAccess?.guestLink || null,
        guestUrl,
        guests: meeting.guestAccess?.guests || [],
        canEnableGuestAccess: meeting.type === 'online'
      }
    })

  } catch (error) {
    console.error('Error getting guest access status:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to get guest access status' },
      { status: 500 }
    )
  }
}
