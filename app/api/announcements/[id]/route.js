import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPushToUsers } from '@/lib/pushNotification'
import mongoose from 'mongoose'

// GET - Get single announcement by ID and mark as read
export async function GET(request, { params }) {
  try {
    const { id } = await params

    const auth = await getAuthAndModels(request, ['Announcement', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Announcement, User, Employee } = models

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, message: 'Invalid announcement ID format' },
        { status: 400 }
      )
    }

    const announcement = await Announcement.findById(id)
      .populate('createdBy', 'firstName lastName profilePicture department designation')
      .populate('departments', 'name')
      .populate('targetDepartments', 'name')

    if (!announcement) {
      return NextResponse.json(
        { success: false, message: 'Announcement not found' },
        { status: 404 }
      )
    }

    // Mark as read (add to views array if not already viewed)
    try {
      const userId = auth.user._id || auth.user.userId
      const employee = await Employee.findOne({ userId }).select('_id')
      if (employee) {
        const alreadyViewed = announcement.views?.some(
          v => v.employee?.toString() === employee._id.toString()
        )
        if (!alreadyViewed) {
          await Announcement.findByIdAndUpdate(id, {
            $push: { views: { employee: employee._id, viewedAt: new Date() } },
            $inc: { 'engagement.totalViews': 1 }
          })
        }
      }
    } catch (viewErr) {
      console.error('[Announcement GET] Error marking as read:', viewErr)
    }

    return NextResponse.json({
      success: true,
      data: announcement,
    })
  } catch (error) {
    console.error('[Announcement GET] Error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch announcement' },
      { status: 500 }
    )
  }
}

// PUT - Update announcement (Admin, HR, Manager, Department Head only)
export async function PUT(request, { params }) {
  try {
    const { id } = await params

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Announcement', 'User', 'Notification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Announcement, User, Notification } = models

    // Role-based access: only admin, hr, super_admin, manager, department_head can update
    const allowedRoles = ['admin', 'hr', 'super_admin', 'manager', 'department_head']
    if (!allowedRoles.includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'You do not have permission to update announcements' },
        { status: 403 }
      )
    }

    const data = await request.json()

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, message: 'Invalid announcement ID format' },
        { status: 400 }
      )
    }

    const announcement = await Announcement.findByIdAndUpdate(
      id,
      data,
      { new: true, runValidators: true }
    ).populate('createdBy', 'firstName lastName')

    if (!announcement) {
      return NextResponse.json(
        { success: false, message: 'Announcement not found' },
        { status: 404 }
      )
    }

    // Send push notification about announcement update
    try {
      const allUsers = await User.find({ role: { $in: ['employee', 'manager', 'hr', 'admin', 'department_head'] } }).select('_id')
      const userIds = allUsers.map(u => u._id.toString())

      if (userIds.length > 0) {
        await sendPushToUsers(
          userIds,
          {
            title: '📢 Announcement Updated',
            body: announcement.title
          },
          {
            url: '/dashboard/announcements',
            type: 'announcement_update',
            data: {
              announcementId: id.toString()
            },
            models: { User, Notification }
          }
        )

        console.log(`Announcement update notification sent to ${userIds.length} user(s)`)
      }
    } catch (notifError) {
      console.error('Failed to send announcement update notification:', notifError)
    }

    return NextResponse.json({
      success: true,
      message: 'Announcement updated successfully',
      data: announcement,
    })
  } catch (error) {
    console.error('Update announcement error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update announcement' },
      { status: 500 }
    )
  }
}

// DELETE - Delete announcement (Admin, HR only)
export async function DELETE(request, { params }) {
  try {
    const { id } = await params

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Announcement'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Announcement } = models

    // Role-based access: only admin, hr, super_admin can delete
    const allowedRoles = ['admin', 'hr', 'super_admin']
    if (!allowedRoles.includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'You do not have permission to delete announcements' },
        { status: 403 }
      )
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, message: 'Invalid announcement ID format' },
        { status: 400 }
      )
    }

    const announcement = await Announcement.findByIdAndDelete(id)

    if (!announcement) {
      return NextResponse.json(
        { success: false, message: 'Announcement not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Announcement deleted successfully',
    })
  } catch (error) {
    console.error('Delete announcement error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete announcement' },
      { status: 500 }
    )
  }
}

