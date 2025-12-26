import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

// GET - List scheduled notifications
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['ScheduledNotification', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { ScheduledNotification, Employee, User } = models

    // Get query params
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') // 'pending', 'sent', 'cancelled', 'failed'

    // Get current employee from auth user
    const employeeId = user.employeeId?._id || user.employeeId
    let currentEmployee = null
    if (employeeId) {
      currentEmployee = await Employee.findById(employeeId)
    }

    const isDeptHead = user.role === 'department_head' || currentEmployee?.isDepartmentHead

    // Check if user has permission
    if (!['admin', 'hr'].includes(user.role) && !isDeptHead) {
      return NextResponse.json(
        { success: false, message: 'You do not have permission to view scheduled notifications' },
        { status: 403 }
      )
    }

    // Build query based on role
    let query = {}

    // Add status filter if provided
    if (status) {
      query.status = status
    }

    if (isDeptHead && !['admin', 'hr'].includes(user.role) && currentEmployee) {
      // Department heads can only see their own scheduled notifications
      query.createdBy = currentEmployee._id
    } else if (user.role === 'hr' && currentEmployee) {
      // HR can see their own and department-specific notifications
      query.$or = [
        { createdBy: currentEmployee._id },
        { targetDepartment: currentEmployee.department }
      ]
    }
    // Admin can see all (no role-based filter)

    const notifications = await ScheduledNotification.find(query)
      .populate('createdBy', 'firstName lastName')
      .populate('targetDepartment', 'name')
      .sort({ scheduledFor: status === 'sent' ? -1 : 1 }) // Sent: most recent first; Others: soonest first

    return NextResponse.json({
      success: true,
      data: notifications
    })
  } catch (error) {
    console.error('Get scheduled notifications error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch scheduled notifications' },
      { status: 500 }
    )
  }
}

// POST - Create scheduled notification
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['ScheduledNotification', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { ScheduledNotification, Employee, User } = models

    // Get current employee from auth user
    const employeeId = user.employeeId?._id || user.employeeId
    let currentEmployee = null
    if (employeeId) {
      currentEmployee = await Employee.findById(employeeId)
    }

    const isDeptHead = user.role === 'department_head' || currentEmployee?.isDepartmentHead

    // Check if user has permission
    if (!['admin', 'hr'].includes(user.role) && !isDeptHead) {
      return NextResponse.json(
        { success: false, message: 'You do not have permission to create scheduled notifications' },
        { status: 403 }
      )
    }

    const data = await request.json()
    const { title, message, url, targetType, targetDepartment, targetUsers, targetRoles, scheduledFor } = data

    // Validate required fields
    if (!title || !message || !scheduledFor) {
      return NextResponse.json(
        { success: false, message: 'Title, message, and scheduled time are required' },
        { status: 400 }
      )
    }

    // Validate scheduled time is in the future
    const scheduleDate = new Date(scheduledFor)
    if (scheduleDate <= new Date()) {
      return NextResponse.json(
        { success: false, message: 'Scheduled time must be in the future' },
        { status: 400 }
      )
    }

    // Create scheduled notification
    const scheduledNotification = await ScheduledNotification.create({
      title,
      message,
      url: url || '/dashboard',
      targetType: targetType || 'all',
      targetDepartment: targetType === 'department' ? targetDepartment : null,
      targetUsers: targetType === 'specific' ? targetUsers : [],
      targetRoles: targetType === 'role' ? targetRoles : [],
      scheduledFor: scheduleDate,
      createdBy: currentEmployee ? currentEmployee._id : user._id,
      createdByRole: user.role,
      status: 'pending'
    })

    return NextResponse.json({
      success: true,
      message: `Notification scheduled for ${scheduleDate.toLocaleString()}`,
      data: scheduledNotification
    })
  } catch (error) {
    console.error('Create scheduled notification error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to create scheduled notification' },
      { status: 500 }
    )
  }
}

// DELETE - Cancel scheduled notification
export async function DELETE(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['ScheduledNotification', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { ScheduledNotification, Employee, User } = models

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'Notification ID is required' },
        { status: 400 }
      )
    }

    const notification = await ScheduledNotification.findById(id)

    if (!notification) {
      return NextResponse.json(
        { success: false, message: 'Notification not found' },
        { status: 404 }
      )
    }

    // Check permission - get current employee
    const employeeId = user.employeeId?._id || user.employeeId
    let currentEmployee = null
    if (employeeId) {
      currentEmployee = await Employee.findById(employeeId)
    }

    if (user.role === 'department_head' && currentEmployee && notification.createdBy.toString() !== currentEmployee._id.toString()) {
      return NextResponse.json(
        { success: false, message: 'You can only cancel your own scheduled notifications' },
        { status: 403 }
      )
    }

    // Update status to cancelled
    notification.status = 'cancelled'
    await notification.save()

    return NextResponse.json({
      success: true,
      message: 'Scheduled notification cancelled successfully'
    })
  } catch (error) {
    console.error('Cancel scheduled notification error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to cancel scheduled notification' },
      { status: 500 }
    )
  }
}

