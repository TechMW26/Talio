import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPushToUser } from '@/lib/pushNotification'
import { sendMeetingResponseEmail } from '@/lib/mailer'
import { dismissNotificationsForReference } from '@/lib/actionableNotifications'

export const dynamic = 'force-dynamic'

// POST - Respond to meeting invitation (accept/reject)
export async function POST(request, { params }) {
  try {
    const { id } = await params

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Meeting', 'Employee', 'User', 'ActionableNotification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Meeting, Employee, User, ActionableNotification } = models

    const data = await request.json();
    // Support both 'response' and older status names for compatibility
    const response = data.response || (data.status === 'tentative' ? 'maybe' : data.status)
    const reason = data.reason; // response: 'accepted', 'rejected/declined', 'maybe/tentative'

    const normalizedResponse = response === 'declined' ? 'rejected' : (response === 'tentative' ? 'maybe' : response)

    if (!normalizedResponse || !['accepted', 'rejected', 'maybe'].includes(normalizedResponse)) {
      return NextResponse.json({ 
        success: false, 
        message: 'Invalid response. Must be accepted, rejected/declined, or maybe/tentative' 
      }, { status: 400 });
    }

    // Get current user's employee record - first check User.employeeId, then Employee.userId
    const userRecord = await User.findById(user._id || user.userId).select('employeeId').lean()
    
    let employee = null
    if (userRecord?.employeeId) {
      employee = await Employee.findById(userRecord.employeeId).lean()
    }
    
    // If user doesn't have employeeId directly, try to find employee by userId
    if (!employee) {
      employee = await Employee.findOne({ userId: user._id || user.userId }).lean()
    }

    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const meeting = await Meeting.findById(id)
      .populate({
        path: 'organizer',
        select: 'firstName lastName userId email'
      })

    if (!meeting) {
      return NextResponse.json({ success: false, message: 'Meeting not found' }, { status: 404 })
    }

    // Populate organizer's userId separately to avoid nested model issues
    if (meeting.organizer?.userId) {
      try {
        const organizer = await Employee.findById(meeting.organizer._id)
          .select('userId')
          .populate({
            path: 'userId',
            select: 'email'
          })
          .lean()
        if (organizer?.userId?.email) {
          meeting.organizer.userEmail = organizer.userId.email
        }
      } catch (err) {
        console.warn('[MeetingRespond] Warning: Could not populate organizer userId:', err.message)
      }
    }

    // Find user's invitation
    const inviteeIndex = meeting.invitees.findIndex(
      inv => inv.employee?.toString() === employee._id.toString()
    )

    if (inviteeIndex === -1) {
      return NextResponse.json({ 
        success: false, 
        message: 'You are not invited to this meeting' 
      }, { status: 403 })
    }

    // Update invitation status
    meeting.invitees[inviteeIndex].status = normalizedResponse
    meeting.invitees[inviteeIndex].respondedAt = new Date()

    if (normalizedResponse === 'rejected' && reason) {
      meeting.invitees[inviteeIndex].rejectionReason = reason
    }

    await meeting.save()
    
    // Dismiss actionable notification for this meeting invitation
    try {
      await dismissNotificationsForReference(models, 'Meeting', id)
    } catch (dismissErr) {
      console.error('[MeetingRespond] Error dismissing notifications:', dismissErr)
      // Don't fail the request
    }

    // Notify organizer about the response
    const organizerUserId = meeting.organizer?.userId?._id || meeting.organizer?.userId
    if (organizerUserId) {
      const statusEmoji = normalizedResponse === 'accepted' ? '✅' : normalizedResponse === 'rejected' ? '❌' : '❓'
      const statusText = normalizedResponse === 'accepted' ? 'accepted' : normalizedResponse === 'rejected' ? 'declined' : 'marked as maybe for'

      sendPushToUser(organizerUserId, {
        title: `${statusEmoji} Meeting Response`,
        body: `${employee.firstName} ${employee.lastName} ${statusText} "${meeting.title}"${normalizedResponse === 'rejected' && reason ? `. Reason: ${reason}` : ''}`
      }, {
        eventType: 'meeting-response',
        clickAction: `/dashboard/meetings/${meeting._id}`,
        data: { 
          meetingId: meeting._id.toString(),
          response: normalizedResponse,
          respondent: employee._id.toString()
        }
      }).catch(console.error)

      // Get organizer's email from the populated userId or direct email field
      const organizerEmail = meeting.organizer?.userEmail || meeting.organizer?.email
      if (organizerEmail) {
        sendMeetingResponseEmail({
          to: organizerEmail,
          organizerName: `${meeting.organizer.firstName} ${meeting.organizer.lastName}`,
          inviteeName: `${employee.firstName} ${employee.lastName}`,
          meetingTitle: meeting.title,
          response: normalizedResponse,
          reason: normalizedResponse === 'rejected' ? reason : null
        }).catch(err => {
          console.error('Failed to send meeting response email:', err.message)
        })
      }

      // Socket notification
      if (global.io) {
        global.io.to(`user:${organizerUserId}`).emit('meeting-response', {
          meetingId: meeting._id,
          title: meeting.title,
          respondent: {
            _id: employee._id,
            firstName: employee.firstName,
            lastName: employee.lastName
          },
          response: normalizedResponse,
          reason: reason || null
        })
      }
    }

    return NextResponse.json({
      success: true,
      message: `Meeting invitation ${normalizedResponse}`,
      data: {
        status: normalizedResponse,
        respondedAt: meeting.invitees[inviteeIndex].respondedAt
      }
    })
  } catch (error) {
    console.error('Meeting invitation response error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
