import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPushToUsers } from '@/lib/pushNotification'

// PUT - Update announcement
export async function PUT(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Announcement', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Announcement, User } = models

    const data = await request.json()

    const announcement = await Announcement.findByIdAndUpdate(
      params.id,
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
              announcementId: announcement._id.toString()
            }
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

// DELETE - Delete announcement
export async function DELETE(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Announcement'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Announcement } = models

    const announcement = await Announcement.findByIdAndDelete(params.id)

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

