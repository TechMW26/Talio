import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import { sendPushToUser } from '@/lib/pushNotification'

export const dynamic = 'force-dynamic'

// GET - Get single meeting
export async function GET(request, { params }) {
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
    const { models } = auth
    const { Meeting, Employee, User } = models

    const meeting = await Meeting.findById(id)
      .populate('organizer', 'firstName lastName email profilePicture')
      .populate('invitees.employee', 'firstName lastName email profilePicture department')
      .populate('invitedDepartments', 'name code')
      .populate('mom.actionItems.assignedTo', 'firstName lastName')
      .populate('agenda.presenter', 'firstName lastName')
      .populate('attachments.uploadedBy', 'firstName lastName')
      .lean()

    if (!meeting) {
      return NextResponse.json({ success: false, message: 'Meeting not found' }, { status: 404 })
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

    // Check if user has access (organizer or invitee)
    const isOrganizer = meeting.organizer?._id?.toString() === employee?._id?.toString()
    const userInvite = meeting.invitees?.find(
      inv => inv.employee?._id?.toString() === employee?._id?.toString()
    )

    if (!isOrganizer && !userInvite) {
      return NextResponse.json({ 
        success: false, 
        message: 'You do not have access to this meeting' 
      }, { status: 403 })
    }

    return NextResponse.json({
      success: true,
      data: {
        ...meeting,
        isOrganizer,
        myInviteStatus: userInvite?.status || null
      }
    })
  } catch (error) {
    console.error('Get meeting error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// PUT - Update meeting
export async function PUT(request, { params }) {
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

    const data = await request.json()

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

    if (!meeting) {
      return NextResponse.json({ success: false, message: 'Meeting not found' }, { status: 404 })
    }

    // Only organizer can update meeting details
    if (meeting.organizer.toString() !== employee._id.toString()) {
      return NextResponse.json({ 
        success: false, 
        message: 'Only the organizer can update meeting details' 
      }, { status: 403 })
    }

    // Fields that can be updated
    const updateableFields = [
      'title', 'description', 'scheduledStart', 'scheduledEnd', 
      'location', 'priority', 'agenda', 'tags', 'notes', 'status'
    ]

    for (const field of updateableFields) {
      if (data[field] !== undefined) {
        meeting[field] = data[field]
      }
    }

    // Handle adding new invitees
    if (data.addInvitees && Array.isArray(data.addInvitees)) {
      for (const empId of data.addInvitees) {
        const exists = meeting.invitees.find(i => i.employee.toString() === empId.toString())
        if (!exists && empId.toString() !== employee._id.toString()) {
          meeting.invitees.push({
            employee: empId,
            status: 'pending',
            notificationSent: false,
            emailSent: false,
            pushSent: false
          })

          // Send notification to new invitee
          const inviteeEmp = await Employee.findById(empId).populate('user', '_id').lean()
          if (inviteeEmp?.user?._id) {
            sendPushToUser(inviteeEmp.user._id, {
              title: '📅 Meeting Invitation',
              body: `${employee.firstName} ${employee.lastName} invited you to "${meeting.title}"`
            }, {
              eventType: 'meeting-invite',
              clickAction: `/dashboard/meetings/${meeting._id}`,
              data: { meetingId: meeting._id.toString() }
            }).catch(console.error)
          }
        }
      }
    }

    // Handle removing invitees
    if (data.removeInvitees && Array.isArray(data.removeInvitees)) {
      meeting.invitees = meeting.invitees.filter(
        i => !data.removeInvitees.includes(i.employee.toString())
      )
    }

    // Recalculate duration if times changed
    if (data.scheduledStart || data.scheduledEnd) {
      const startTime = new Date(meeting.scheduledStart)
      const endTime = new Date(meeting.scheduledEnd)
      meeting.duration = Math.round((endTime - startTime) / (1000 * 60))
    }

    await meeting.save()

    await meeting.populate([
      { path: 'organizer', select: 'firstName lastName email profilePicture' },
      { path: 'invitees.employee', select: 'firstName lastName email profilePicture' },
      { path: 'invitedDepartments', select: 'name code' }
    ])

    return NextResponse.json({
      success: true,
      message: 'Meeting updated successfully',
      data: meeting
    })
  } catch (error) {
    console.error('Update meeting error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// DELETE - Cancel/Delete meeting
export async function DELETE(request, { params }) {
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

    const { searchParams } = new URL(request.url)
    const reason = searchParams.get('reason') || 'Meeting cancelled'

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
      .populate('invitees.employee', 'user')

    if (!meeting) {
      return NextResponse.json({ success: false, message: 'Meeting not found' }, { status: 404 })
    }

    // Only organizer can cancel/delete meeting
    if (meeting.organizer.toString() !== employee._id.toString()) {
      return NextResponse.json({ 
        success: false, 
        message: 'Only the organizer can cancel the meeting' 
      }, { status: 403 })
    }

    // Cancel meeting instead of deleting (soft delete)
    meeting.status = 'cancelled'
    meeting.cancelledBy = employee._id
    meeting.cancellationReason = reason
    meeting.cancelledAt = new Date()

    await meeting.save()

    // Notify all invitees
    for (const invitee of meeting.invitees) {
      if (invitee.employee?.user) {
        const userId = invitee.employee.user._id || invitee.employee.user
        sendPushToUser(userId, {
          title: '❌ Meeting Cancelled',
          body: `"${meeting.title}" has been cancelled. Reason: ${reason}`
        }, {
          eventType: 'meeting-cancelled',
          clickAction: `/dashboard/meetings`,
          data: { meetingId: meeting._id.toString() }
        }).catch(console.error)

        // Socket notification
        if (global.io) {
          global.io.to(`user:${userId}`).emit('meeting-cancelled', {
            meetingId: meeting._id,
            title: meeting.title,
            reason
          })
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Meeting cancelled successfully'
    })
  } catch (error) {
    console.error('Delete meeting error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
