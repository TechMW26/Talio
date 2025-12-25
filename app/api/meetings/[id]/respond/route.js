import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import { sendPushToUser } from '@/lib/pushNotification'
import { sendMeetingResponseEmail } from '@/lib/mailer'

export const dynamic = 'force-dynamic'

// POST - Respond to meeting invitation (accept/reject)
export async function POST(request, { params }) {
  try {
    const { id } = await params

    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Meeting', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Meeting, Employee, User } = models

    const data = await request.json()
    const { response, reason } = data // response: 'accepted', 'rejected', 'maybe'

    if (!response || !['accepted', 'rejected', 'maybe'].includes(response)) {
      return NextResponse.json({ 
        success: false, 
        message: 'Invalid response. Must be accepted, rejected, or maybe' 
      }, { status: 400 })
    }

    // Get current user's employee record - first check User.employeeId, then Employee.userId
    const user = await User.findById(decoded.userId).select('employeeId').lean()
    
    let employee = null
    if (user?.employeeId) {
      employee = await Employee.findById(user.employeeId).lean()
    }
    
    // If user doesn't have employeeId directly, try to find employee by userId
    if (!employee) {
      employee = await Employee.findOne({ userId: decoded.userId }).lean()
    }

    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const meeting = await Meeting.findById(id)
      .populate('organizer', 'firstName lastName user')

    if (!meeting) {
      return NextResponse.json({ success: false, message: 'Meeting not found' }, { status: 404 })
    }

    // Find user's invitation
    const inviteeIndex = meeting.invitees.findIndex(
      inv => inv.employee.toString() === employee._id.toString()
    )

    if (inviteeIndex === -1) {
      return NextResponse.json({ 
        success: false, 
        message: 'You are not invited to this meeting' 
      }, { status: 403 })
    }

    // Update invitation status
    meeting.invitees[inviteeIndex].status = response
    meeting.invitees[inviteeIndex].respondedAt = new Date()

    if (response === 'rejected' && reason) {
      meeting.invitees[inviteeIndex].rejectionReason = reason
    }

    await meeting.save()

    // Notify organizer about the response
    if (meeting.organizer?.user) {
      const organizerUserId = meeting.organizer.user._id || meeting.organizer.user
      
      const statusEmoji = response === 'accepted' ? '✅' : response === 'rejected' ? '❌' : '❓'
      const statusText = response === 'accepted' ? 'accepted' : response === 'rejected' ? 'declined' : 'marked as maybe for'

      sendPushToUser(organizerUserId, {
        title: `${statusEmoji} Meeting Response`,
        body: `${employee.firstName} ${employee.lastName} ${statusText} "${meeting.title}"${response === 'rejected' && reason ? `. Reason: ${reason}` : ''}`
      }, {
        eventType: 'meeting-response',
        clickAction: `/dashboard/meetings/${meeting._id}`,
        data: { 
          meetingId: meeting._id.toString(),
          response,
          respondent: employee._id.toString()
        }
      }).catch(console.error)

      // Send email to organizer about response
      const organizerEmployee = await Employee.findById(meeting.organizer._id)
        .populate('user', 'email')
        .lean()
      
      const organizerEmail = organizerEmployee?.email || organizerEmployee?.user?.email
      if (organizerEmail) {
        sendMeetingResponseEmail({
          to: organizerEmail,
          organizerName: `${meeting.organizer.firstName} ${meeting.organizer.lastName}`,
          inviteeName: `${employee.firstName} ${employee.lastName}`,
          meetingTitle: meeting.title,
          response,
          reason: response === 'rejected' ? reason : null
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
          response,
          reason: reason || null
        })
      }
    }

    return NextResponse.json({
      success: true,
      message: `Meeting invitation ${response}`,
      data: {
        status: response,
        respondedAt: meeting.invitees[inviteeIndex].respondedAt
      }
    })
  } catch (error) {
    console.error('Meeting invitation response error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
