import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { jwtVerify } from 'jose'
// GET - List recurring notifications
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['RecurringNotification', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { RecurringNotification, Employee, User } = models

    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const token = authHeader.substring(7)
    const secret = new TextEncoder().encode(process.env.JWT_SECRET)
    const { payload: decoded } = await jwtVerify(token, secret)

    const currentUser = await User.findById(decoded.userId).populate('employeeId')

    // Find employee by reverse lookup
    let currentEmployee = null
    if (currentUser && currentUser.employeeId) {
      currentEmployee = await Employee.findById(currentUser.employeeId)
    }

    const isDeptHead = decoded.role === 'department_head' || currentEmployee?.isDepartmentHead

    // Check if user has permission
    if (!['admin', 'hr'].includes(decoded.role) && !isDeptHead) {
      return NextResponse.json(
        { success: false, message: 'You do not have permission to view recurring notifications' },
        { status: 403 }
      )
    }

    // Build query based on role
    let query = {}

    if (isDeptHead && !['admin', 'hr'].includes(decoded.role) && currentEmployee) {
      // Department heads can only see their own recurring notifications
      query.createdBy = currentEmployee._id
    } else if (decoded.role === 'hr' && currentEmployee) {
      // HR can see their own and department-specific notifications
      query.$or = [
        { createdBy: currentEmployee._id },
        { targetDepartment: currentEmployee.department }
      ]
    }
    // Admin can see all (no filter)

    const notifications = await RecurringNotification.find(query)
      .populate('createdBy', 'firstName lastName')
      .populate('targetDepartment', 'name')
      .sort({ createdAt: -1 })

    return NextResponse.json({
      success: true,
      data: notifications
    })
  } catch (error) {
    console.error('Get recurring notifications error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch recurring notifications' },
      { status: 500 }
    )
  }
}

// POST - Create recurring notification
export async function POST(request) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const token = authHeader.substring(7)
    const secret = new TextEncoder().encode(process.env.JWT_SECRET)
    const { payload: decoded } = await jwtVerify(token, secret)

    const data = await request.json()
    const currentUser = await User.findById(decoded.userId).populate('employeeId')

    // Find employee by reverse lookup
    let currentEmployee = null
    if (currentUser && currentUser.employeeId) {
      currentEmployee = await Employee.findById(currentUser.employeeId)
    }

    const isDeptHead = decoded.role === 'department_head' || currentEmployee?.isDepartmentHead

    // Check if user has permission
    if (!['admin', 'hr'].includes(decoded.role) && !isDeptHead) {
      return NextResponse.json(
        { success: false, message: 'You do not have permission to create recurring notifications' },
        { status: 403 }
      )
    }

    // Department heads (non-admin/hr) cannot use 'department' or 'role' target types
    if (isDeptHead && !['admin', 'hr'].includes(decoded.role)) {
      if (data.targetType === 'department') {
        return NextResponse.json(
          { success: false, message: 'Department heads can only send to their own department members' },
          { status: 403 }
        )
      }
      if (data.targetType === 'role') {
        return NextResponse.json(
          { success: false, message: 'Department heads cannot send notifications by role' },
          { status: 403 }
        )
      }

      // For 'all' and 'users' target types, restrict to department members
      if (data.targetType === 'all' && currentEmployee) {
        data.targetType = 'department'
        data.targetDepartment = currentEmployee.department
      }
    }

    // Clean up empty strings to null for ObjectId fields
    if (data.targetDepartment === '' || data.targetDepartment === undefined) {
      data.targetDepartment = null
    }

    // Validate required fields
    if (!data.title || !data.message) {
      return NextResponse.json(
        { success: false, message: 'Title and message are required' },
        { status: 400 }
      )
    }

    if (!data.frequency) {
      return NextResponse.json(
        { success: false, message: 'Frequency is required' },
        { status: 400 }
      )
    }

    // Validate frequency-specific fields
    if (data.frequency === 'weekly' && (!data.weeklyDays || data.weeklyDays.length === 0)) {
      return NextResponse.json(
        { success: false, message: 'Please select at least one day for weekly notifications' },
        { status: 400 }
      )
    }

    // Set default startDate if not provided (start immediately)
    if (!data.startDate) {
      data.startDate = new Date()
    } else {
      // Convert string date to Date object
      data.startDate = new Date(data.startDate)
    }

    // Convert endDate if provided
    if (data.endDate && data.endDate !== '') {
      data.endDate = new Date(data.endDate)
    } else {
      data.endDate = null
    }

    // Ensure targetType has a default
    if (!data.targetType) {
      data.targetType = 'all'
    }

    // Create recurring notification
    const recurringNotif = await RecurringNotification.create({
      ...data,
      createdBy: currentEmployee ? currentEmployee._id : decoded.userId,
      createdByRole: decoded.role
    })

    // Calculate next scheduled time
    recurringNotif.nextScheduledAt = recurringNotif.calculateNextSchedule()
    await recurringNotif.save()

    const populated = await RecurringNotification.findById(recurringNotif._id)
      .populate('createdBy', 'firstName lastName')
      .populate('targetDepartment', 'name')

    return NextResponse.json({
      success: true,
      message: 'Recurring notification created successfully',
      data: populated
    })
  } catch (error) {
    console.error('Create recurring notification error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create recurring notification' },
      { status: 500 }
    )
  }
}

// PUT - Update recurring notification
export async function PUT(request) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const token = authHeader.substring(7)
    const secret = new TextEncoder().encode(process.env.JWT_SECRET)
    const { payload: decoded } = await jwtVerify(token, secret)

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const data = await request.json()

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'Notification ID is required' },
        { status: 400 }
      )
    }

    const notification = await RecurringNotification.findById(id)

    if (!notification) {
      return NextResponse.json(
        { success: false, message: 'Notification not found' },
        { status: 404 }
      )
    }

    // Check permission
    const currentUser = await User.findById(decoded.userId).populate('employeeId')

    // Find employee by reverse lookup
    let currentEmployee = null
    if (currentUser && currentUser.employeeId) {
      currentEmployee = await Employee.findById(currentUser.employeeId)
    }

    const isDeptHead = decoded.role === 'department_head' || currentEmployee?.isDepartmentHead

    if (isDeptHead && !['admin', 'hr'].includes(decoded.role) && currentEmployee && notification.createdBy.toString() !== currentEmployee._id.toString()) {
      return NextResponse.json(
        { success: false, message: 'You can only update your own recurring notifications' },
        { status: 403 }
      )
    }

    // Update notification
    Object.assign(notification, data)

    // Recalculate next scheduled time if schedule changed
    if (data.frequency || data.dailyTime || data.weeklyDays || data.weeklyTime || data.monthlyDay || data.monthlyTime || data.customDays || data.customTimes) {
      notification.nextScheduledAt = notification.calculateNextSchedule()
    }

    await notification.save()

    const populated = await RecurringNotification.findById(notification._id)
      .populate('createdBy', 'firstName lastName')
      .populate('targetDepartment', 'name')

    return NextResponse.json({
      success: true,
      message: 'Recurring notification updated successfully',
      data: populated
    })
  } catch (error) {
    console.error('Update recurring notification error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update recurring notification' },
      { status: 500 }
    )
  }
}

// PATCH - Toggle active status
export async function PATCH(request) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const token = authHeader.substring(7)
    const secret = new TextEncoder().encode(process.env.JWT_SECRET)
    const { payload: decoded } = await jwtVerify(token, secret)

    const data = await request.json()
    const { id, isActive } = data

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'Notification ID is required' },
        { status: 400 }
      )
    }

    const notification = await RecurringNotification.findById(id)

    if (!notification) {
      return NextResponse.json(
        { success: false, message: 'Notification not found' },
        { status: 404 }
      )
    }

    // Check permission
    const currentUser = await User.findById(decoded.userId).populate('employeeId')
    let currentEmployee = null
    if (currentUser && currentUser.employeeId) {
      currentEmployee = await Employee.findById(currentUser.employeeId)
    }

    const isDeptHead = decoded.role === 'department_head' || currentEmployee?.isDepartmentHead

    if (isDeptHead && !['admin', 'hr'].includes(decoded.role) && currentEmployee && notification.createdBy.toString() !== currentEmployee._id.toString()) {
      return NextResponse.json(
        { success: false, message: 'You can only update your own recurring notifications' },
        { status: 403 }
      )
    }

    // Update isActive status
    notification.isActive = isActive

    // If activating, recalculate next scheduled time
    if (isActive) {
      notification.nextScheduledAt = notification.calculateNextSchedule()
    }

    await notification.save()

    const populated = await RecurringNotification.findById(notification._id)
      .populate('createdBy', 'firstName lastName')
      .populate('targetDepartment', 'name')

    return NextResponse.json({
      success: true,
      message: isActive ? 'Notification resumed' : 'Notification paused',
      data: populated
    })
  } catch (error) {
    console.error('Toggle recurring notification error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update notification' },
      { status: 500 }
    )
  }
}

// DELETE - Delete recurring notification
export async function DELETE(request) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const token = authHeader.substring(7)
    const secret = new TextEncoder().encode(process.env.JWT_SECRET)
    const { payload: decoded } = await jwtVerify(token, secret)

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'Notification ID is required' },
        { status: 400 }
      )
    }

    const notification = await RecurringNotification.findById(id)

    if (!notification) {
      return NextResponse.json(
        { success: false, message: 'Notification not found' },
        { status: 404 }
      )
    }

    // Check permission
    const currentUser = await User.findById(decoded.userId).populate('employeeId')

    // Find employee by reverse lookup
    let currentEmployee = null
    if (currentUser && currentUser.employeeId) {
      currentEmployee = await Employee.findById(currentUser.employeeId)
    }

    const isDeptHead = decoded.role === 'department_head' || currentEmployee?.isDepartmentHead

    if (isDeptHead && !['admin', 'hr'].includes(decoded.role) && currentEmployee && notification.createdBy.toString() !== currentEmployee._id.toString()) {
      return NextResponse.json(
        { success: false, message: 'You can only delete your own recurring notifications' },
        { status: 403 }
      )
    }

    await RecurringNotification.findByIdAndDelete(id)

    return NextResponse.json({
      success: true,
      message: 'Recurring notification deleted successfully'
    })
  } catch (error) {
    console.error('Delete recurring notification error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete recurring notification' },
      { status: 500 }
    )
  }
}

