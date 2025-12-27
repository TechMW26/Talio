import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
// GET - Fetch user's notifications
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Notification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Notification } = models
    const userId = user._id || user.userId

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const unreadOnly = searchParams.get('unreadOnly') === 'true'

    // Build query
    const query = { user: userId }
    if (unreadOnly) {
      query.read = false
    }

    // Get total count
    const total = await Notification.countDocuments(query)

    // Get notifications with pagination
    const notifications = await Notification.find(query)
      .populate('sentBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()

    // Get unread count
    const unreadCount = await Notification.countDocuments({
      user: userId,
      read: false
    })

    return NextResponse.json({
      success: true,
      data: notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      },
      unreadCount
    })
  } catch (error) {
    console.error('Get notifications error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch notifications' },
      { status: 500 }
    )
  }
}

// PATCH - Mark notification(s) as read
export async function PATCH(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Notification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Notification } = models
    const userId = user._id || user.userId

    const data = await request.json()
    const { notificationIds, markAllAsRead } = data

    if (markAllAsRead) {
      // Mark all notifications as read
      await Notification.updateMany(
        { user: userId, read: false },
        { read: true, readAt: new Date() }
      )

      return NextResponse.json({
        success: true,
        message: 'All notifications marked as read'
      })
    } else if (notificationIds && Array.isArray(notificationIds)) {
      // Mark specific notifications as read
      await Notification.updateMany(
        { _id: { $in: notificationIds }, user: userId },
        { read: true, readAt: new Date() }
      )

      return NextResponse.json({
        success: true,
        message: `${notificationIds.length} notification(s) marked as read`
      })
    } else {
      return NextResponse.json(
        { success: false, message: 'Invalid request' },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error('Mark notifications as read error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to mark notifications as read' },
      { status: 500 }
    )
  }
}

// DELETE - Delete notification(s)
export async function DELETE(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Notification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Notification } = models
    const userId = user._id || user.userId

    const { searchParams } = new URL(request.url)
    const notificationId = searchParams.get('id')
    const deleteAll = searchParams.get('deleteAll') === 'true'

    if (deleteAll) {
      // Delete all read notifications
      const result = await Notification.deleteMany({
        user: userId,
        read: true
      })

      return NextResponse.json({
        success: true,
        message: `${result.deletedCount} notification(s) deleted`
      })
    } else if (notificationId) {
      // Delete specific notification
      const result = await Notification.deleteOne({
        _id: notificationId,
        user: userId
      })

      if (result.deletedCount === 0) {
        return NextResponse.json(
          { success: false, message: 'Notification not found' },
          { status: 404 }
        )
      }

      return NextResponse.json({
        success: true,
        message: 'Notification deleted'
      })
    } else {
      return NextResponse.json(
        { success: false, message: 'Invalid request' },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error('Delete notification error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete notification' },
      { status: 500 }
    )
  }
}

