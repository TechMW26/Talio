import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPushToUser } from '@/lib/pushNotification'
import { sendMeetingInviteEmail } from '@/lib/mailer'
import { emitMeetingUpdate } from '@/lib/realtimeEvents'
import { createMeetingInvitationNotification } from '@/lib/actionableNotifications'
import { getEndOfDayInTimezone, getStartOfDayInTimezone, parseDateTimeInTimezone, IST_TIMEZONE } from '@/lib/timezone'
import crypto from 'crypto'
import { generateRecurringStarts } from '@/lib/meetingRecurrence'

export const dynamic = 'force-dynamic'

// Generate unique room ID for online meetings
function generateRoomId() {
  return crypto.randomBytes(12).toString('hex')
}

// GET - List meetings
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Meeting', 'Employee', 'Department', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Meeting, Employee, Department, User } = models

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') // online, offline, all
    const status = searchParams.get('status') // scheduled, in-progress, completed, cancelled
    const view = searchParams.get('view') // my-meetings, invited, all
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const roomIdParam = searchParams.get('roomId')?.trim().slice(0, 160) // For fetching specific meeting by room ID
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10) || 20))

    // Get employee ID from user - first check User.employeeId, then Employee.userId
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

    // Build query
    const query = {}

    // If fetching by roomId, use that directly (for meeting room page)
    if (roomIdParam) {
      query.roomId = roomIdParam
      query.$or = [
        { organizer: employee._id },
        { 'invitees.employee': employee._id }
      ]
    }

    // Filter by type
    if (type && type !== 'all') {
      query.type = type
    }

    // Filter by status
    if (status) {
      query.status = status
    }

    // Filter by date range
    if (startDate || endDate) {
      query.scheduledStart = {}
      if (startDate) {
        query.scheduledStart.$gte = getStartOfDayInTimezone(startDate, IST_TIMEZONE)
      }
      if (endDate) {
        query.scheduledStart.$lte = getEndOfDayInTimezone(endDate, IST_TIMEZONE)
      }
    }

    // Filter by view type. Room lookups already include an explicit access scope.
    if (!roomIdParam) {
      if (view === 'my-meetings') {
        query.organizer = employee._id
      } else if (view === 'invited') {
        query['invitees.employee'] = employee._id
      } else {
        // All meetings where user is organizer or invitee
        query.$or = [
          { organizer: employee._id },
          { 'invitees.employee': employee._id }
        ]
      }
    }

    const skip = (page - 1) * limit

    const [meetings, total] = await Promise.all([
      Meeting.find(query)
        .populate('organizer', 'firstName lastName email profilePicture')
        .populate('invitees.employee', 'firstName lastName email profilePicture')
        .populate('invitedDepartments', 'name code')
        .sort({ scheduledStart: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Meeting.countDocuments(query)
    ])

    // Add user's invitation status to each meeting
    const meetingsWithStatus = meetings.map(meeting => {
      const userInvite = meeting.invitees?.find(
        inv => inv.employee?._id?.toString() === employee._id.toString()
      )
      return {
        ...meeting,
        myInviteStatus: userInvite?.status || null,
        isOrganizer: meeting.organizer?._id?.toString() === employee._id.toString()
      }
    })

    return NextResponse.json({
      success: true,
      data: meetingsWithStatus,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Get meetings error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// POST - Create a new meeting
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Meeting', 'Employee', 'Department', 'User', 'Notification', 'ActionableNotification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Meeting, Employee, Department, User, Notification } = models

    const data = await request.json()

    // Get employee ID from authenticated user
    const employeeId = user.employeeId?._id || user.employeeId
    
    let organizer = null
    if (employeeId) {
      organizer = await Employee.findById(employeeId).lean()
    }
    
    // If user doesn't have employeeId directly, try to find employee by userId
    if (!organizer) {
      organizer = await Employee.findOne({ userId: user._id }).lean()
    }

    if (!organizer) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }
    
    // Add userId to organizer for notification purposes
    organizer.userId = user._id

    // Validate required fields
    if (!data.title || !data.type || !data.scheduledStart || !data.scheduledEnd) {
      return NextResponse.json({ 
        success: false, 
        message: 'Title, type, start time and end time are required' 
      }, { status: 400 })
    }

    // Parse and validate times
    let startTime = parseDateTimeInTimezone(data.scheduledStart, IST_TIMEZONE)
    let endTime = parseDateTimeInTimezone(data.scheduledEnd, IST_TIMEZONE)

    // Validate that dates are valid
    if (!startTime || !endTime || isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      return NextResponse.json({ 
        success: false, 
        message: 'Invalid date format for start or end time' 
      }, { status: 400 })
    }

    // Smart time handling: If end time is before or equal to start time, auto-set end time to 1 hour after start
    if (endTime <= startTime) {
      endTime = new Date(startTime.getTime() + 60 * 60 * 1000) // Add 1 hour
      console.log(`[Meeting] Auto-adjusted end time to 1 hour after start: ${endTime.toISOString()}`)
    }

    // Calculate duration in minutes
    const durationMinutes = Math.round((endTime - startTime) / (1000 * 60))

    // Validate meeting type
    if (data.type === 'offline' && !data.location) {
      return NextResponse.json({ 
        success: false, 
        message: 'Location is required for offline meetings' 
      }, { status: 400 })
    }

    const recurrenceStarts = data.isRecurring
      ? generateRecurringStarts(startTime, data.recurrence)
      : [startTime]
    if (data.isRecurring && (!data.recurrence?.endDate || recurrenceStarts.length === 0)) {
      return NextResponse.json({
        success: false,
        message: 'A valid recurrence end date and schedule are required',
      }, { status: 400 })
    }

    // Prepare invitees with pending status
    const invitees = []
    
    // Add individual invitees
    if (data.inviteeIds && Array.isArray(data.inviteeIds)) {
      for (const employeeId of data.inviteeIds) {
        // Don't add organizer as invitee
        if (employeeId.toString() !== organizer._id.toString()) {
          invitees.push({
            employee: employeeId,
            status: 'pending',
            notificationSent: false,
            emailSent: false,
            pushSent: false
          })
        }
      }
    }

    // Add department invitees
    let invitedDepartments = []
    if (data.departmentIds && Array.isArray(data.departmentIds)) {
      invitedDepartments = data.departmentIds

      // Get all employees from selected departments
      const deptEmployees = await Employee.find({
        $or: [
          { department: { $in: data.departmentIds } },
          { departments: { $in: data.departmentIds } }
        ],
        status: 'active',
        _id: { $ne: organizer._id } // Exclude organizer
      }).select('_id').lean()

      for (const emp of deptEmployees) {
        // Check if already added
        const exists = invitees.find(i => i.employee.toString() === emp._id.toString())
        if (!exists) {
          invitees.push({
            employee: emp._id,
            status: 'pending',
            notificationSent: false,
            emailSent: false,
            pushSent: false
          })
        }
      }
    }

    // Generate roomId for online meetings
    const roomId = data.type === 'online' ? generateRoomId() : undefined

    // Create meeting - use startTime/endTime for tenant schema compatibility
    // Note: startTime, endTime, and durationMinutes were already calculated above during validation
    const meeting = new Meeting({
      title: data.title,
      description: data.description || '',
      type: data.type,
      // Tenant schema uses startTime/endTime (required fields)
      startTime: startTime,
      endTime: endTime,
      // Also set scheduledStart/scheduledEnd for backward compatibility
      scheduledStart: startTime,
      scheduledEnd: endTime,
      duration: durationMinutes,
      location: data.location,
      isOnline: data.type === 'online',
      roomId: roomId,
      organizer: organizer._id,
      invitees,
      invitedDepartments,
      priority: data.priority || 'medium',
      agenda: data.agenda || [],
      tags: data.tags || [],
      isRecurring: data.isRecurring || false,
      recurrence: data.recurrence && typeof data.recurrence === 'object' ? data.recurrence : undefined,
      reminders: data.reminders || [{ time: new Date(startTime.getTime() - 15 * 60 * 1000), sent: false }]
    })

    await meeting.save()

    const seriesMeetings = [meeting]
    if (data.isRecurring) {
      const seriesId = meeting._id.toString()
      meeting.recurrence.seriesId = seriesId
      meeting.recurrence.occurrenceIndex = 1
      await meeting.save()

      for (let index = 1; index < recurrenceStarts.length; index += 1) {
        const occurrenceStart = recurrenceStarts[index]
        const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMinutes * 60 * 1000)
        const occurrence = await Meeting.create({
          title: data.title,
          description: data.description || '',
          type: data.type,
          startTime: occurrenceStart,
          endTime: occurrenceEnd,
          scheduledStart: occurrenceStart,
          scheduledEnd: occurrenceEnd,
          duration: durationMinutes,
          location: data.location,
          isOnline: data.type === 'online',
          roomId: data.type === 'online' ? generateRoomId() : undefined,
          organizer: organizer._id,
          invitees: invitees.map(item => ({ ...item })),
          invitedDepartments,
          priority: data.priority || 'medium',
          agenda: data.agenda || [],
          tags: data.tags || [],
          isRecurring: true,
          recurrence: {
            ...data.recurrence,
            parentMeeting: meeting._id,
            seriesId,
            occurrenceIndex: index + 1,
          },
          reminders: [{ time: new Date(occurrenceStart.getTime() - 15 * 60 * 1000), sent: false }],
        })
        seriesMeetings.push(occurrence)
      }
    }

    // Populate for response
    await meeting.populate([
      { path: 'organizer', select: 'firstName lastName email profilePicture' },
      { path: 'invitees.employee', select: 'firstName lastName email profilePicture' },
      { path: 'invitedDepartments', select: 'name code' }
    ])

    // Send notifications to invitees
    const notificationPromises = []
    const emailPromises = []
    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    
    // Send email to organizer (meeting creator)
    const organizerEmail = organizer.email || (organizer.userId && organizer.userId.email)
    if (organizerEmail) {
      for (const occurrence of seriesMeetings) emailPromises.push(
        sendMeetingInviteEmail({
          to: organizerEmail,
          inviteeName: `${organizer.firstName} ${organizer.lastName}`,
          organizerName: 'You',
          meetingTitle: meeting.title,
          meetingType: meeting.type,
          startTime: occurrence.scheduledStart,
          endTime: occurrence.scheduledEnd,
          location: occurrence.location,
          description: occurrence.description,
          meetingLink: occurrence.type === 'online' ? `${baseUrl}/dashboard/meetings/room/${occurrence.roomId}` : null,
          respondLink: `${baseUrl}/dashboard/meetings/${occurrence._id}`
        }).catch(err => {
          console.error(`Failed to send email to organizer ${organizer._id}:`, err.message)
        })
      )
    }

    for (const invitee of meeting.invitees) {
      const emp = await Employee.findById(invitee.employee).populate('userId', '_id email').lean()
      if (emp?.userId?._id) {
        // Push notification
        notificationPromises.push(
          sendPushToUser(emp.userId._id, {
            title: '📅 Meeting Invitation',
            body: `${organizer.firstName} ${organizer.lastName} invited you to "${meeting.title}" on ${startTime.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} at ${startTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
          }, {
            eventType: 'meeting-invite',
            clickAction: `/dashboard/meetings/${meeting._id}`,
            icon: '/icons/icon-192x192.png',
            data: {
              meetingId: meeting._id.toString(),
              type: meeting.type
            }
          }).then(() => {
            // Mark notification as sent
            Meeting.updateOne(
              { _id: meeting._id, 'invitees.employee': invitee.employee },
              { $set: { 'invitees.$.pushSent': true, 'invitees.$.notificationSent': true } }
            ).exec()
          }).catch(err => {
            console.error(`Failed to send push to invitee ${invitee.employee}:`, err.message)
          })
        )
        
        // Email invitation
        const inviteeEmail = emp.email || emp.userId?.email
        if (inviteeEmail) {
          for (const occurrence of seriesMeetings) emailPromises.push(
            sendMeetingInviteEmail({
              to: inviteeEmail,
              inviteeName: `${emp.firstName} ${emp.lastName}`,
              organizerName: `${organizer.firstName} ${organizer.lastName}`,
              meetingTitle: meeting.title,
              meetingType: meeting.type,
              startTime: occurrence.scheduledStart,
              endTime: occurrence.scheduledEnd,
              location: occurrence.location,
              description: occurrence.description,
              meetingLink: occurrence.type === 'online' ? `${baseUrl}/dashboard/meetings/room/${occurrence.roomId}` : null,
              respondLink: `${baseUrl}/dashboard/meetings/${occurrence._id}`
            }).then(() => {
              // Mark email as sent
              Meeting.updateOne(
                { _id: occurrence._id, 'invitees.employee': invitee.employee },
                { $set: { 'invitees.$.emailSent': true } }
              ).exec()
            }).catch(err => {
              console.error(`Failed to send email to invitee ${invitee.employee}:`, err.message)
            })
          )
        }
      }
    }

    // Don't wait for notifications and emails to complete
    Promise.all([...notificationPromises, ...emailPromises]).catch(console.error)

    // Emit socket event for real-time updates
    if (global.io) {
      for (const invitee of meeting.invitees) {
        const emp = await Employee.findById(invitee.employee).populate('userId', '_id').lean()
        if (emp?.userId?._id) {
          global.io.to(`user:${emp.userId._id}`).emit('meeting-invite', {
            meeting: meeting.toObject(),
            organizer: {
              _id: organizer._id,
              firstName: organizer.firstName,
              lastName: organizer.lastName
            }
          })
          
          // Create actionable notification for meeting invitation (persistent toast)
          try {
            await createMeetingInvitationNotification(models, {
              targetUserId: emp.userId._id,
              meetingId: meeting._id,
              meetingTitle: meeting.title,
              organizerId: organizer._id,
              organizerName: `${organizer.firstName} ${organizer.lastName}`,
              startTime: meeting.scheduledStart,
              endTime: meeting.scheduledEnd,
              isRecurring: !!meeting.recurrence
            })
          } catch (actionErr) {
            console.error('[Meetings] Error creating actionable notification:', actionErr)
            // Don't fail the request if actionable notification fails
          }
        }
      }
    }

    // Emit standardized real-time event for dashboard updates
    emitMeetingUpdate(meeting.toObject(), [], { isNew: true, broadcast: true })

    return NextResponse.json({
      success: true,
      message: data.isRecurring
        ? `Recurring meeting created with ${seriesMeetings.length} occurrence(s)`
        : 'Meeting created successfully',
      data: meeting,
      recurrence: data.isRecurring ? { occurrenceCount: seriesMeetings.length } : undefined
    }, { status: 201 })
  } catch (error) {
    console.error('Create meeting error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
