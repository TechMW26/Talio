import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

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
    const userDoc = await User.findById(user._id || user.userId).select('employeeId')
    if (!userDoc || !userDoc.employeeId) {
      // Return 0 unread for users without employee records
      return NextResponse.json({
        success: true,
        totalUnread: 0,
        unreadByChat: {},
        message: 'No employee record linked to this user'
      })
    }

    // Get employee details
    const employee = await Employee.findById(userDoc.employeeId)
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Find all chats where user is a participant
    const chats = await Chat.find({
      participants: employee._id
    }).select('messages participants')

    let totalUnread = 0
    const unreadByChat = {}

    // Count unread messages in each chat
    for (const chat of chats) {
      let chatUnread = 0
      
      if (!chat.messages || !Array.isArray(chat.messages)) continue;

      for (const message of chat.messages) {
        // Skip invalid messages
        if (!message || !message.sender) continue;

        // Check if message is from someone else and not read by current user
        if (message.sender.toString() !== employee._id.toString()) {
          const isReadByUser = message.isRead?.some(
            read => read && read.user && read.user.toString() === employee._id.toString()
          )
          
          if (!isReadByUser) {
            chatUnread++
          }
        }
      }
      
      if (chatUnread > 0) {
        unreadByChat[chat._id.toString()] = chatUnread
        totalUnread += chatUnread
      }
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

