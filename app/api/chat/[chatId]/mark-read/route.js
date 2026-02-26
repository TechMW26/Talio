import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { emitChatUnreadUpdated } from '@/lib/eventBus'
import mongoose from 'mongoose'

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) &&
    (new mongoose.Types.ObjectId(id)).toString() === id
}

// POST - Mark all messages in a chat as read
export async function POST(request, context) {
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
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Get employee details
    const employee = await Employee.findById(userDoc.employeeId)
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const params = await context.params
    const chatId = params.chatId

    if (!isValidObjectId(chatId)) {
      return NextResponse.json({ success: false, message: 'Invalid chat ID' }, { status: 400 })
    }

    // Find the chat
    const chat = await Chat.findById(chatId)
    if (!chat) {
      return NextResponse.json({ success: false, message: 'Chat not found' }, { status: 404 })
    }

    // Check if user is a participant
    if (!chat.participants.some(p => p.toString() === employee._id.toString())) {
      return NextResponse.json({ success: false, message: 'Not a participant' }, { status: 403 })
    }

    // Mark all unread messages as read
    let markedCount = 0
    for (const message of chat.messages) {
      // Skip messages sent by current user
      if (message.sender.toString() === employee._id.toString()) {
        continue
      }

      // Check if already read by user
      const alreadyRead = message.isRead?.some(
        read => read.user.toString() === employee._id.toString()
      )

      if (!alreadyRead) {
        if (!message.isRead) {
          message.isRead = []
        }
        message.isRead.push({
          user: employee._id,
          readAt: new Date()
        })
        markedCount++
      }
    }

    if (markedCount > 0) {
      await chat.save()

      // ── Emit chat.unread.updated so the frontend decrements counts in real-time ──
      try {
        const userId = (user._id || user.userId).toString()
        emitChatUnreadUpdated(
          { chatId: params.chatId, action: 'mark_read', markedCount },
          [userId],
          auth.tenant?.databaseName
        ).catch(err => console.error('[MarkRead] emitChatUnreadUpdated error:', err.message))
      } catch (eventErr) {
        console.error('[MarkRead] Failed to emit unread update event:', eventErr)
      }
    }

    return NextResponse.json({
      success: true,
      markedCount,
      message: `Marked ${markedCount} messages as read`
    })
  } catch (error) {
    console.error('[API] Error marking messages as read:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to mark messages as read', error: error.message },
      { status: 500 }
    )
  }
}

