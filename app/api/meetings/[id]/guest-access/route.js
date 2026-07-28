import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getAuthAndModels } from '@/lib/auth'

function getGuestBaseUrl(request) {
  if (process.env.NODE_ENV !== 'production') {
    return request.nextUrl.origin
  }
  return (process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/+$/, '')
}

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

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { success: false, message: 'Guest access state must be true or false' },
        { status: 400 }
      )
    }

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

    // Generate a stable guest link once, then atomically persist the nested
    // guest-access state. The tenant model previously treated this as an
    // untyped object, so mutating only `.enabled` was not reliably tracked.
    let guestLink = meeting.guestAccess?.guestLink || null
    const guestAccessUpdates = {
      'guestAccess.enabled': enabled,
    }

    // Encode the exact tenant database name so guest lookup never has to guess it.
    if (enabled && !guestLink) {
      const encodedTenant = Buffer.from(auth.tenant.databaseName, 'utf8').toString('base64url')
      guestLink = `v2.${encodedTenant}.${randomUUID()}`
      guestAccessUpdates['guestAccess.guestLink'] = guestLink
      guestAccessUpdates['guestAccess.guestLinkCreatedAt'] = new Date()
      guestAccessUpdates['guestAccess.tenantDatabase'] = auth.tenant.databaseName
    }

    const updatedMeeting = await models.Meeting.findByIdAndUpdate(
      id,
      { $set: guestAccessUpdates },
      { new: true, runValidators: true }
    ).select('guestAccess')

    if (!updatedMeeting) {
      return NextResponse.json(
        { success: false, message: 'Meeting not found' },
        { status: 404 }
      )
    }

    // Generate full guest URL
    const baseUrl = getGuestBaseUrl(request)
    const guestUrl = enabled && guestLink ? `${baseUrl}/join/${guestLink}` : null

    return NextResponse.json({
      success: true,
      data: {
        guestAccessEnabled: Boolean(updatedMeeting.guestAccess?.enabled),
        guestLink: updatedMeeting.guestAccess?.guestLink || guestLink,
        guestUrl,
        guests: updatedMeeting.guestAccess?.guests || [],
        canEnableGuestAccess: true,
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

    const baseUrl = getGuestBaseUrl(request)
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
