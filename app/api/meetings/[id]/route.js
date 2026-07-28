import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPushToUser } from '@/lib/pushNotification'
import { resolveMeetingEmployee } from '@/lib/meetingParticipants'
import { sortMeetingTranscript } from '@/lib/meetingLanguage'
import { parseDateTimeInTimezone, IST_TIMEZONE } from '@/lib/timezone'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET - Get single meeting
export async function GET(request, { params }) {
  try {
    const { id } = await params

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Meeting', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Meeting, Employee, User } = models

    const meeting = await Meeting.findById(id)
      .populate('organizer', 'firstName lastName email profilePicture')
      .populate('invitees.employee', 'firstName lastName email profilePicture department')
      .populate('invitedDepartments', 'name code')
      .populate('mom.actionItems.assignedTo', 'firstName lastName')
      .populate('agenda.presenter', 'firstName lastName')
      .populate('attachments.uploadedBy', 'firstName lastName')
      .populate('transcript.speaker', 'firstName lastName')
      .populate('aiParticipantNotes.employee', 'firstName lastName email profilePicture')
      .lean()

    if (!meeting) {
      return NextResponse.json({ success: false, message: 'Meeting not found' }, { status: 404 })
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
        transcript: sortMeetingTranscript(meeting.transcript || []),
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

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Meeting', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Meeting, Employee, User } = models

    const data = await request.json()

    // Get current user's employee record - first check User.employeeId, then Employee.userId
    const employee = await resolveMeetingEmployee(models, user)

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
      'location', 'priority', 'agenda', 'tags', 'notes', 'status', 'actualStart', 'actualEnd'
    ]

    for (const field of updateableFields) {
      if (data[field] !== undefined) {
        const isMeetingDate = ['scheduledStart', 'scheduledEnd'].includes(field)
        meeting[field] = isMeetingDate
          ? parseDateTimeInTimezone(data[field], IST_TIMEZONE)
          : data[field]
      }
    }

    if ((data.scheduledStart && !meeting.scheduledStart) || (data.scheduledEnd && !meeting.scheduledEnd)) {
      return NextResponse.json({ success: false, message: 'Invalid meeting date or time' }, { status: 400 })
    }

    // Handle adding new invitees
    if (data.addInvitees && Array.isArray(data.addInvitees)) {
      for (const empId of data.addInvitees) {
        const exists = meeting.invitees.find(i => i.employee.toString() === empId.toString())
        if (!exists && empId.toString() !== employee._id.toString()) {
          meeting.invitees.push({
            employee: empId,
            status: meeting.status === 'in-progress' ? 'accepted' : 'pending',
            ...(meeting.status === 'in-progress' ? { respondedAt: new Date() } : {}),
            notificationSent: false,
            emailSent: false,
            pushSent: false
          })

          // Send notification to new invitee
          const inviteeEmp = await Employee.findById(empId).select('userId').lean()
          if (inviteeEmp?.userId) {
            sendPushToUser(inviteeEmp.userId, {
              title: '📅 Meeting Invitation',
              body: `${employee.firstName} ${employee.lastName} invited you to "${meeting.title}"`
            }, {
              eventType: 'meeting-invite',
              clickAction: `/dashboard/meetings/${meeting._id}`,
              data: { meetingId: meeting._id.toString() }
            }).catch(console.error)

            if (global.io) {
              global.io.to(`user:${inviteeEmp.userId}`).emit('meeting-invite', {
                meetingId: meeting._id.toString(),
                roomId: meeting.roomId,
                title: meeting.title,
                status: meeting.status,
                invitedDuringMeeting: meeting.status === 'in-progress',
              })
            }
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

    const { searchParams } = new URL(request.url)
    const reason = searchParams.get('reason') || 'Meeting cancelled'
    const permanentDelete = searchParams.get('permanent') === 'true'

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Meeting', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Meeting, Employee, User } = models

    // Get current user's employee record
    const userRecord = await User.findById(user._id || user.userId).select('employeeId').lean()
    
    let employee = null
    if (userRecord?.employeeId) {
      employee = await Employee.findById(userRecord.employeeId).lean()
    }
    
    if (!employee) {
      employee = await Employee.findOne({ userId: user._id || user.userId }).lean()
    }

    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const meeting = await Meeting.findById(id)
      .populate('invitees.employee', 'userId')

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

    // If permanent delete requested, actually delete the meeting
    if (permanentDelete) {
      const deletedDataSummary = {
        notesPresent: Boolean(String(meeting.notes || '').trim()),
        transcriptSegments: Array.isArray(meeting.transcript) ? meeting.transcript.length : 0,
        participantNotes: Array.isArray(meeting.aiParticipantNotes) ? meeting.aiParticipantNotes.length : 0,
        summaryHistoryEntries: Array.isArray(meeting.aiSummary?.history) ? meeting.aiSummary.history.length : 0,
        momEntries: Array.isArray(meeting.mom) ? meeting.mom.length : 0,
        offlineAudioSegments: Array.isArray(meeting.offlineAudio?.segments) ? meeting.offlineAudio.segments.length : 0,
        guestEntries: Array.isArray(meeting.guestAccess?.guests) ? meeting.guestAccess.guests.length : 0,
      }

      await meeting.deleteOne()

      console.info('[Meetings] Permanently deleted meeting and embedded data', {
        meetingId: meeting._id.toString(),
        ...deletedDataSummary,
      })
      
      // Notify all invitees about deletion
      for (const invitee of meeting.invitees) {
        if (invitee.employee?.userId) {
          const userId = invitee.employee.userId
          sendPushToUser(userId, {
            title: '🗑️ Meeting Deleted',
            body: `"${meeting.title}" has been deleted.`
          }, {
            eventType: 'meeting-deleted',
            clickAction: `/dashboard/meetings`,
            data: { meetingId: meeting._id.toString() }
          }).catch(console.error)

          if (global.io) {
            global.io.to(`user:${userId}`).emit('meeting-deleted', {
              meetingId: meeting._id,
              title: meeting.title
            })
          }
        }
      }

      return NextResponse.json({
        success: true,
        message: 'Meeting deleted successfully',
        data: {
          purged: deletedDataSummary,
        },
      })
    }

    // Cancel meeting (soft delete)
    meeting.status = 'cancelled'
    meeting.cancelledBy = employee._id
    meeting.cancellationReason = reason
    meeting.cancelledAt = new Date()

    await meeting.save()

    // Notify all invitees
    for (const invitee of meeting.invitees) {
      if (invitee.employee?.userId) {
        const userId = invitee.employee.userId
        sendPushToUser(userId, {
          title: '❌ Meeting Cancelled',
          body: `"${meeting.title}" has been cancelled. Reason: ${reason}`
        }, {
          eventType: 'meeting-cancelled',
          clickAction: `/dashboard/meetings`,
          data: { meetingId: meeting._id.toString() }
        }).catch(console.error)

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
