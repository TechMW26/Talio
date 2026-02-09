import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'


// GET - Get unread message count for current user
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Chat', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Chat, Employee, User } = models

    // Get user to find employee ID
    const userDoc = await User.findById(user._id || user.userId).select('employeeId').lean()
    if (!userDoc || !userDoc.employeeId) {
      // Return 0 unread for users without employee records
      return NextResponse.json({
        success: true,
        totalUnread: 0,
        unreadByChat: {},
        message: 'No employee record linked to this user'
      })
    }

    let employeeId
    try {
      employeeId = new mongoose.Types.ObjectId(userDoc.employeeId)
    } catch (idError) {
      console.warn('[API] Invalid employeeId format:', userDoc.employeeId)
      return NextResponse.json({
        success: true,
        totalUnread: 0,
        unreadByChat: {},
        message: 'Invalid employee ID format'
      })
    }

    // First check if user has any chats at all to avoid unnecessary aggregation
    const hasChats = await Chat.exists({ participants: employeeId })
    if (!hasChats) {
      return NextResponse.json({
        success: true,
        totalUnread: 0,
        unreadByChat: {}
      })
    }

    // Use aggregation to count unread messages efficiently in MongoDB
    let unreadCounts = []
    try {
      unreadCounts = await Chat.aggregate([
        // Match only chats where user is a participant
        { $match: { participants: employeeId } },
        // Unwind messages array
        { $unwind: { path: '$messages', preserveNullAndEmptyArrays: false } },
        // Filter: message not from current user AND not read by current user
        {
          $match: {
            'messages.sender': { $ne: employeeId },
            'messages.isRead.user': { $ne: employeeId }
          }
        },
        // Group by chat ID and count unread messages
        {
          $group: {
            _id: '$_id',
            unreadCount: { $sum: 1 }
          }
        }
      ])
    } catch (aggError) {
      console.warn('[API] Chat aggregation error (collection may not exist):', aggError.message)
      unreadCounts = []
    }

    // Build response
    let totalUnread = 0
    const unreadByChat = {}

    for (const item of unreadCounts) {
      unreadByChat[item._id.toString()] = item.unreadCount
      totalUnread += item.unreadCount
    }

    return NextResponse.json({
      success: true,
      totalUnread,
      unreadByChat
    })
  } catch (error) {
    console.error('[API] Error getting unread count:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to get unread count', error: error.message },
      { status: 500 }
    )
  }
}

