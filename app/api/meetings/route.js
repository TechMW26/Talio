import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import { sendPushToUser } from '@/lib/pushNotification'
import { sendMeetingInviteEmail } from '@/lib/mailer'

export const dynamic = 'force-dynamic'

// GET - List meetings
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

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
    const roomIdParam = searchParams.get('roomId') // For fetching specific meeting by room ID
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')

    // Get employee ID from user - first check User.employeeId, then Employee.userId
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

    // Build query
    const query = {}

    // If fetching by roomId, use that directly (for meeting room page)
    if (roomIdParam) {
      query.roomId = roomIdParam
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
        query.scheduledStart.$gte = new Date(startDate)
      }
      if (endDate) {
        query.scheduledStart.$lte = new Date(endDate)
      }
    }

    // Filter by view type (skip if searching by roomId - we want the specific meeting)
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
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    const data = await request.json()

    // Get employee ID from user - first check User.employeeId, then Employee.userId
    const user = await User.findById(decoded.userId).select('employeeId').lean()
    
    let organizer = null
    if (user?.employeeId) {
      organizer = await Employee.findById(user.employeeId).lean()
    }
    
    // If user doesn't have employeeId directly, try to find employee by userId
    if (!organizer) {
      organizer = await Employee.findOne({ userId: decoded.userId }).lean()
    }

    if (!organizer) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }
    
    // Add userId to organizer for notification purposes
    organizer.userId = decoded.userId

    // Validate required fields
    if (!data.title || !data.type || !data.scheduledStart || !data.scheduledEnd) {
      return NextResponse.json({ 
        success: false, 
        message: 'Title, type, start time and end time are required' 
      }, { status: 400 })
    }

    // Validate meeting type
    if (data.type === 'offline' && !data.location) {
      return NextResponse.json({ 
        success: false, 
        message: 'Location is required for offline meetings' 
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

    // Calculate duration in minutes
    const startTime = new Date(data.scheduledStart)
    const endTime = new Date(data.scheduledEnd)
    const durationMinutes = Math.round((endTime - startTime) / (1000 * 60))

    // Create meeting
    const meeting = new Meeting({
      title: data.title,
      description: data.description || '',
      type: data.type,
      scheduledStart: startTime,
      scheduledEnd: endTime,
      duration: durationMinutes,
      location: data.location,
      organizer: organizer._id,
      invitees,
      invitedDepartments,
      priority: data.priority || 'medium',
      agenda: data.agenda || [],
      tags: data.tags || [],
      isRecurring: data.isRecurring || false,
      recurrence: data.recurrence,
      reminders: data.reminders || [{ type: '15min', sent: false }]
    })

    await meeting.save()

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
      emailPromises.push(
        sendMeetingInviteEmail({
          to: organizerEmail,
          inviteeName: `${organizer.firstName} ${organizer.lastName}`,
          organizerName: 'You',
          meetingTitle: meeting.title,
          meetingType: meeting.type,
          startTime: meeting.scheduledStart,
          endTime: meeting.scheduledEnd,
          location: meeting.location,
          description: meeting.description,
          meetingLink: meeting.type === 'online' ? `${baseUrl}/dashboard/meetings/room/${meeting.roomId}` : null,
          respondLink: `${baseUrl}/dashboard/meetings/${meeting._id}`
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
          emailPromises.push(
            sendMeetingInviteEmail({
              to: inviteeEmail,
              inviteeName: `${emp.firstName} ${emp.lastName}`,
              organizerName: `${organizer.firstName} ${organizer.lastName}`,
              meetingTitle: meeting.title,
              meetingType: meeting.type,
              startTime: meeting.scheduledStart,
              endTime: meeting.scheduledEnd,
              location: meeting.location,
              description: meeting.description,
              meetingLink: meeting.type === 'online' ? `${baseUrl}/dashboard/meetings/room/${meeting.roomId}` : null,
              respondLink: `${baseUrl}/dashboard/meetings/${meeting._id}`
            }).then(() => {
              // Mark email as sent
              Meeting.updateOne(
                { _id: meeting._id, 'invitees.employee': invitee.employee },
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
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Meeting created successfully',
      data: meeting
    }, { status: 201 })
  } catch (error) {
    console.error('Create meeting error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
