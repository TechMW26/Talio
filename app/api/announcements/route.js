import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendAnnouncementNotification } from '@/lib/notificationService'
import { emitDashboardRefresh, REALTIME_EVENTS } from '@/lib/realtimeEvents'

// GET - List announcements
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
  const auth = await getAuthAndModels(request, ['Announcement', 'User', 'Employee', 'Notification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
  const { Announcement, User, Employee, Notification } = models

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit')) || 10
    const status = searchParams.get('status') || 'published'

    // Get user info from auth to filter department announcements
    let userDepartment = null
    let userRole = null

    try {
      const userId = auth.user._id || auth.user.userId
      if (!userId) {
        throw new Error('User ID not found')
      }
      const userDoc = await User.findById(userId).select('role')
      const employee = await Employee.findOne({ userId }).select('department')
      
      if (userDoc) {
        userRole = userDoc.role
      }
      if (employee) {
        userDepartment = employee.department
      }

      console.log('[Announcements GET] User role:', userRole)
      console.log('[Announcements GET] User department:', userDepartment?.toString())
    } catch (err) {
      console.error('[Announcements GET] Error getting user info:', err)
    }

    const query = { status }

    // Only show non-expired announcements
    const now = new Date()
    query.$or = [
      { expiryDate: { $exists: false } },
      { expiryDate: null },
      { expiryDate: { $gte: now } }
    ]

    const announcements = await Announcement.find(query)
      .populate('createdBy', 'firstName lastName')
      .populate('departments', 'name')
      .sort({ publishDate: -1 })
      .limit(limit)

    console.log('[Announcements GET] Total announcements found:', announcements.length)

    // Filter announcements based on user's department and role
    const filteredAnnouncements = announcements.filter(announcement => {
      // Admins and HR can see all announcements
      if (userRole === 'admin' || userRole === 'hr' || userRole === 'admin') {
        return true
      }

      // Show all company-wide announcements (not department-specific)
      if (!announcement.isDepartmentAnnouncement || announcement.targetAudience === 'all') {
        return true
      }

      // Show department announcements only to users in that department
      if (announcement.isDepartmentAnnouncement && userDepartment && announcement.departments && announcement.departments.length > 0) {
        return announcement.departments.some(dept => dept && dept._id && dept._id.toString() === userDepartment.toString())
      }

      // If department announcement but user has no department, don't show
      if (announcement.isDepartmentAnnouncement && !userDepartment) {
        return false
      }

      // Default: show the announcement
      return true
    })

    console.log('[Announcements GET] Filtered announcements:', filteredAnnouncements.length)

    return NextResponse.json({
      success: true,
      data: filteredAnnouncements,
    })
  } catch (error) {
    console.error('[Announcements GET] Error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch announcements' },
      { status: 500 }
    )
  }
}

// POST - Create announcement
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
  const auth = await getAuthAndModels(request, ['Announcement', 'User', 'Employee', 'Notification'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
  const { Announcement, User, Employee, Notification } = models

    const data = await request.json()

    if (!data?.title || !data?.content) {
      return NextResponse.json(
        { success: false, message: 'Title and content are required' },
        { status: 400 }
      )
    }

    let creatorRole = user.role
    let creatorDepartment = null
    let creatorEmployeeId = null

    // Get employee profile from auth user
    const employeeId = user.employeeId?._id || user.employeeId
    if (!employeeId) {
      return NextResponse.json(
        { success: false, message: 'Employee profile not found. Please ensure your employee profile is linked to your account.' },
        { status: 404 }
      )
    }

    const employee = await Employee.findById(employeeId).select('_id department')
    if (!employee) {
      return NextResponse.json(
        { success: false, message: 'Employee profile not found.' },
        { status: 404 }
      )
    }

    creatorEmployeeId = employee._id
    creatorDepartment = employee.department

    // Set createdBy field (required by Announcement model)
    data.createdBy = employee._id
    
    console.log('[Announcement] Setting createdBy to:', employee._id.toString())
    console.log('[Announcement] Data before create:', { 
      title: data.title, 
      createdBy: data.createdBy?.toString(),
      createdByRole: user.role,
      department: employee.department?.toString()
    })

    // If user is department head, set department-specific fields
    if (user.role === 'department_head') {
      data.isDepartmentAnnouncement = true
      data.departments = [creatorDepartment]
      data.targetAudience = 'department'
    }

    // If user is manager, set team-specific fields
    if (user.role === 'manager') {
      data.isDepartmentAnnouncement = true
      data.targetAudience = 'department'
      // Department should already be set from frontend, but ensure it's set
      if (!data.departments || data.departments.length === 0) {
        data.departments = [creatorDepartment]
      }
    }

    // Add creator role to announcement
    data.createdByRole = creatorRole

    // Set status to 'published' if not explicitly set
    if (!data.status) {
      data.status = 'published'
    }

    console.log('[Announcement] Final data:', {
      title: data.title,
      status: data.status,
      targetAudience: data.targetAudience,
      isDepartmentAnnouncement: data.isDepartmentAnnouncement
    })

    const announcement = await Announcement.create(data)

    const populatedAnnouncement = await Announcement.findById(announcement._id)
      .populate('createdBy', 'firstName lastName')
      .populate('departments', 'name')

    // Send push notification to targeted users and emit Socket.IO event
    try {
      let targetUsers = []

      // Check if this is a manager announcement (sent to direct reports only)
      if (creatorRole === 'manager' && creatorEmployeeId) {
        // Send to manager's direct reports only
        const directReports = await Employee.find({
          reportingManager: creatorEmployeeId,
          status: 'active'
        }).select('userId')

        const userIds = directReports.map(emp => emp.userId).filter(Boolean)
        targetUsers = await User.find({
          _id: { $in: userIds }
        }).select('_id')
      } else if (announcement.isDepartmentAnnouncement && announcement.departments.length > 0) {
        // Send to department members only (for department heads)
        const deptEmployees = await Employee.find({
          department: { $in: announcement.departments },
          status: 'active'
        }).select('userId')

        const userIds = deptEmployees.map(emp => emp.userId).filter(Boolean)
        targetUsers = await User.find({
          _id: { $in: userIds },
          role: { $in: ['employee', 'manager', 'hr', 'admin', 'department_head'] }
        }).select('_id')
      } else {
        // Send to all users (for admin/hr)
        targetUsers = await User.find({
          role: { $in: ['employee', 'manager', 'hr', 'admin', 'department_head'] }
        }).select('_id')
      }

      const userIds = targetUsers.map(u => u._id.toString())

      if (userIds.length > 0) {
        // Get creator user ID
        const creatorEmployee = await Employee.findById(data.createdBy).select('userId')
        const creatorUserId = creatorEmployee?.userId

        // Send Firebase notification
        await sendAnnouncementNotification({
          announcementId: announcement._id.toString(),
          title: announcement.title,
          content: announcement.content,
          targetUserIds: userIds,
          createdBy: creatorUserId,
          models: { User, Employee, Notification }
        })

        // Emit Socket.IO event for real-time notification
        try {
          const io = global.io
          if (io) {
            const creator = await Employee.findById(data.createdBy).select('firstName lastName')
            const creatorName = creator ? `${creator.firstName} ${creator.lastName}` : 'Admin'

            userIds.forEach(userId => {
              io.to(`user:${userId}`).emit('new-announcement', {
                _id: announcement._id.toString(),
                title: announcement.title,
                content: announcement.content,
                priority: announcement.priority || 'normal',
                createdBy: creatorName
              })
            })
            console.log(`Socket.IO announcement event emitted to ${userIds.length} user(s)`)
            
            // Also emit dashboard refresh for all users
            emitDashboardRefresh({ reason: 'announcement-created' })
          }
        } catch (socketError) {
          console.error('Failed to emit Socket.IO announcement event:', socketError)
        }

        console.log(`Firebase announcement notification sent to ${userIds.length} user(s)`)
      }
    } catch (notifError) {
      console.error('Failed to send announcement notification:', notifError)
    }

    return NextResponse.json({
      success: true,
      message: 'Announcement created successfully',
      data: populatedAnnouncement,
    }, { status: 201 })
  } catch (error) {
    console.error('Create announcement error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create announcement' },
      { status: 500 }
    )
  }
}

