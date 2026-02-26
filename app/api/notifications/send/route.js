import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPushToUsers } from '@/lib/pushNotification'
import { emitEvent, EVENTS } from '@/lib/eventBus'

export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Department', 'Notification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Employee, Department, Notification } = models
    const userId = user._id || user.userId

    // Get current user's employee data to check if they're a department head
    const currentUser = await User.findById(userId)

    console.log('[Notifications] Current user:', {
      userId: userId,
      role: user.role,
      hasEmployeeId: !!currentUser?.employeeId
    })

    // Find employee by reverse lookup (User has employeeId field)
    let currentEmployee = null
    let userDepartment = null
    if (currentUser && currentUser.employeeId) {
      currentEmployee = await Employee.findById(currentUser.employeeId)

      // Check if this employee is a department head
      if (currentEmployee) {
        userDepartment = await Department.findOne({
          head: currentEmployee._id,
          isActive: true
        })
      }

      console.log('[Notifications] Current employee:', {
        employeeId: currentEmployee?._id,
        isDepartmentHead: !!userDepartment,
        department: currentEmployee?.department,
        headOfDepartment: userDepartment?._id
      })
    }

    // Check if user has permission (admin, hr, admin, department_head role, or is a department head)
    const hasPermission = ['admin', 'hr', 'department_head'].includes(user.role) ||
      !!userDepartment

    console.log('[Notifications] Permission check:', {
      role: user.role,
      hasPermission,
      isDepartmentHead: !!userDepartment
    })

    if (!hasPermission) {
      return NextResponse.json(
        { success: false, message: 'You do not have permission to send notifications' },
        { status: 403 }
      )
    }

    const data = await request.json()
    const { title: rawTitle, message: rawMessage, url: rawUrl, targetType, targetDepartment, targetUsers, targetRoles, scheduleType, scheduledFor } = data

    // Sanitize and validate inputs
    const sanitizeInput = (input, maxLength) => {
      if (!input) return ''
      return input
        .toString()
        .trim()
        .substring(0, maxLength)
        .replace(/[<>]/g, '')  // Remove angle brackets to prevent XSS
    }

    const validateUrl = (url) => {
      if (!url) return '/dashboard'
      const urlStr = url.toString().trim()
      // Only allow relative URLs starting with /
      if (!urlStr.startsWith('/')) {
        console.warn(`[Security] Blocked external URL: ${urlStr}`)
        return '/dashboard'
      }
      // Prevent javascript: and data: URLs
      if (urlStr.toLowerCase().includes('javascript:') || urlStr.toLowerCase().includes('data:')) {
        console.warn(`[Security] Blocked malicious URL: ${urlStr}`)
        return '/dashboard'
      }
      return urlStr.substring(0, 200)  // Max URL length
    }

    const title = sanitizeInput(rawTitle, 100)
    const message = sanitizeInput(rawMessage, 1000)
    const url = validateUrl(rawUrl)

    // Validate required fields
    if (!title || !message) {
      return NextResponse.json(
        { success: false, message: 'Title and message are required' },
        { status: 400 }
      )
    }

    // Determine if user is department head (by role or by being head of a department)
    const isDeptHead = user.role === 'department_head' || !!userDepartment

    // Department heads need an employee record to send notifications
    if (isDeptHead && !['admin', 'hr'].includes(user.role) && !currentEmployee) {
      return NextResponse.json(
        { success: false, message: 'Employee record not found. Please contact administrator.' },
        { status: 403 }
      )
    }

    // Department heads (non-admin/hr/admin) cannot use 'department' or 'role' target types
    if (isDeptHead && !['admin', 'hr'].includes(user.role)) {
      if (targetType === 'department') {
        return NextResponse.json(
          { success: false, message: 'Department heads can only send to their own department members' },
          { status: 403 }
        )
      }
      if (targetType === 'role') {
        return NextResponse.json(
          { success: false, message: 'Department heads cannot send notifications by role' },
          { status: 403 }
        )
      }
    }

    // Determine target user IDs based on targetType
    let userIds = []

    if (targetType === 'all') {
      // Department heads can only send to their department
      if (isDeptHead && !['admin', 'hr'].includes(user.role)) {
        const deptEmployees = await Employee.find({
          department: userDepartment._id,
          status: 'active'
        }).select('_id')

        const employeeIds = deptEmployees.map(e => e._id)
        const users = await User.find({ employeeId: { $in: employeeIds } }).select('_id')
        userIds = users.map(u => u._id.toString())
      } else {
        // Admin and HR can send to all
        const users = await User.find({}).select('_id')
        userIds = users.map(u => u._id.toString())
      }
    } else if (targetType === 'department') {
      // Department heads can only send to their own department
      let deptId = targetDepartment
      if (isDeptHead && !['admin', 'hr'].includes(user.role)) {
        deptId = userDepartment._id
      }

      const deptEmployees = await Employee.find({
        department: deptId,
        status: 'active'
      }).select('_id')

      const employeeIds = deptEmployees.map(e => e._id)
      const users = await User.find({ employeeId: { $in: employeeIds } }).select('_id')
      userIds = users.map(u => u._id.toString())
    } else if (targetType === 'role') {
      if (!targetRoles || targetRoles.length === 0) {
        return NextResponse.json(
          { success: false, message: 'Please select at least one role' },
          { status: 400 }
        )
      }

      // Department heads can only send to users in their department
      if (isDeptHead && !['admin', 'hr'].includes(user.role)) {
        const deptEmployees = await Employee.find({
          department: userDepartment._id,
          status: 'active'
        }).select('_id')

        const employeeIds = deptEmployees.map(e => e._id)
        const users = await User.find({
          employeeId: { $in: employeeIds },
          role: { $in: targetRoles }
        }).select('_id')

        userIds = users.map(u => u._id.toString())
      } else {
        const users = await User.find({
          role: { $in: targetRoles }
        }).select('_id')

        userIds = users.map(u => u._id.toString())
      }
    } else if (targetType === 'specific') {
      if (!targetUsers || targetUsers.length === 0) {
        return NextResponse.json(
          { success: false, message: 'Please select at least one user' },
          { status: 400 }
        )
      }

      // Department heads can only send to users in their department
      if (isDeptHead && !['admin', 'hr'].includes(user.role)) {
        const deptEmployees = await Employee.find({
          department: userDepartment._id,
          status: 'active'
        }).select('_id')

        const employeeIds = deptEmployees.map(e => e._id.toString())
        console.log('Department employees found:', employeeIds.length)

        // Get users for these employees
        const deptUsers = await User.find({
          employeeId: { $in: employeeIds }
        }).select('_id')

        const deptUserIds = deptUsers.map(u => u._id.toString())
        console.log('Department users found:', deptUserIds.length)
        console.log('Target users selected:', targetUsers.length)

        // Filter targetUsers to only include users from department
        userIds = targetUsers.filter(userId => deptUserIds.includes(userId.toString()))
        console.log('Filtered user IDs:', userIds.length)
      } else {
        userIds = targetUsers
      }
    }

    console.log('Target type:', targetType)
    console.log('User IDs found:', userIds.length)
    console.log('Is dept head:', isDeptHead)
    console.log('User department:', userDepartment?._id)

    if (userIds.length === 0) {
      return NextResponse.json(
        { success: false, message: 'No users found matching the criteria' },
        { status: 400 }
      )
    }

    // If scheduled for later, create scheduled notification
    if (scheduleType === 'scheduled' && scheduledFor) {
      const ScheduledNotification = (await import('@/models/ScheduledNotification')).default

      const scheduledNotif = await ScheduledNotification.create({
        title,
        message,
        url: url || '/dashboard',
        targetType,
        targetDepartment: targetType === 'department' ? (isDeptHead && !['admin', 'hr'].includes(user.role) && userDepartment ? userDepartment._id : targetDepartment) : null,
        targetUsers: targetType === 'specific' ? userIds : [],
        targetRoles: targetType === 'role' ? targetRoles : [],
        scheduledFor: new Date(scheduledFor),
        createdBy: currentEmployee ? currentEmployee._id : userId,
        createdByRole: user.role,
        recipientCount: userIds.length
      })

      return NextResponse.json({
        success: true,
        message: `Notification scheduled for ${new Date(scheduledFor).toLocaleString()}`,
        data: scheduledNotif
      })
    }

    // Create notification records in database for each user
    const notificationRecords = []
    const now = new Date()

    for (const targetUserId of userIds) {
      const notificationData = {
        user: targetUserId,
        title,
        message,
        url: url || '/dashboard',
        type: 'custom',
        priority: 'medium',
        data: {
          sentBy: currentEmployee ? currentEmployee._id.toString() : userId
        },
        sentBy: currentEmployee ? currentEmployee._id : null,
        sentByRole: user.role,
        deliveryStatus: {
          fcm: { sent: false }
        },
        createdAt: now
      }
      notificationRecords.push(notificationData)
    }

    // Save all notifications to database
    let savedNotifications = []
    try {
      savedNotifications = await Notification.insertMany(notificationRecords)
      console.log(`[Database] Saved ${savedNotifications.length} notification(s) to database`)
    } catch (dbError) {
      console.error('[Database] Error saving notifications:', dbError)
      // Continue even if database save fails
    }

    console.log(`[Notifications] Sending to ${userIds.length} user(s)`)

    // Send Firebase push notification
    let pushResult = { success: false, message: 'No users found' }
    if (userIds.length > 0) {
      try {
        console.log(`[Firebase] Sending push notification to ${userIds.length} user(s)`)

        pushResult = await sendPushToUsers(
          userIds,
          {
            title: title,
            body: message
          },
          {
            data: {
              type: 'custom',
              sentBy: currentEmployee ? currentEmployee._id.toString() : userId,
              url: url || '/dashboard'
            },
            url: url || '/dashboard',
            type: 'custom'
          }
        )

        if (pushResult.success) {
          console.log(`[Firebase] Push notification sent successfully to ${pushResult.successCount || userIds.length} user(s)`)

          // Update delivery status in database
          if (savedNotifications.length > 0) {
            await Notification.updateMany(
              { _id: { $in: savedNotifications.map(n => n._id) } },
              {
                'deliveryStatus.fcm.sent': true,
                'deliveryStatus.fcm.sentAt': new Date()
              }
            )
          }
        } else {
          console.warn(`[Firebase] Failed to send push notification:`, pushResult.message)
        }
      } catch (firebaseError) {
        console.error('[Firebase] Error sending push notification:', firebaseError)
        pushResult = { success: false, message: firebaseError.message }
      }
    }

    // Success if Firebase succeeded OR notifications saved to DB
    const notificationSent = pushResult.success || savedNotifications.length > 0

    if (!notificationSent) {
      console.warn('[Notification] Firebase and database save both failed')
      return NextResponse.json(
        { success: false, message: 'Failed to send notifications' },
        { status: 500 }
      )
    }

    // Save to ScheduledNotification for history tracking (immediate send)
    try {
      const ScheduledNotification = (await import('@/models/ScheduledNotification')).default
      await ScheduledNotification.create({
        title,
        message,
        url: url || '/dashboard',
        targetType,
        targetDepartment: targetType === 'department' ? (isDeptHead && !['admin', 'hr'].includes(user.role) && userDepartment ? userDepartment._id : targetDepartment) : null,
        targetUsers: targetType === 'specific' ? userIds : [],
        targetRoles: targetType === 'role' ? targetRoles : [],
        scheduledFor: now,
        sentAt: now,
        createdBy: currentEmployee ? currentEmployee._id : userId,
        createdByRole: user.role,
        recipientCount: userIds.length,
        status: 'sent'
      })
      console.log('[History] Saved notification to history')
    } catch (historyError) {
      console.error('[History] Error saving to history:', historyError)
      // Don't fail the request if history save fails
    }

    // Emit sidebar counts update via eventBus for all recipients
    try {
      emitEvent(EVENTS.NOTIFICATION_CREATED, {
        title,
        message,
        recipientCount: userIds.length,
        sentBy: currentEmployee ? currentEmployee._id.toString() : userId,
      }, {
        userIds: userIds.map(id => id.toString()),
        databaseName: auth.tenant?.databaseName,
      })
    } catch (eventBusError) {
      console.error('Failed to emit eventBus notification event:', eventBusError)
    }

    return NextResponse.json({
      success: true,
      message: `Notification sent to ${userIds.length} user(s)`,
      data: {
        recipientCount: userIds.length,
        savedToDatabase: savedNotifications.length,
        firebasePushSuccess: pushResult.success,
        methods: {
          database: savedNotifications.length > 0 ? 'saved' : 'failed',
          firebasePush: pushResult.success ? 'sent' : 'failed'
        }
      }
    })
  } catch (error) {
    console.error('Send notification error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to send notification' },
      { status: 500 }
    )
  }
}

