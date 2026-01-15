import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendMessageNotification } from '@/lib/notificationService'
import mongoose from 'mongoose'

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) &&
    (new mongoose.Types.ObjectId(id)).toString() === id
}

// GET - Fetch messages for a chat
export async function GET(request, context) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Chat', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Chat, Employee } = models

    const params = await context.params
    const { chatId } = params

    if (!isValidObjectId(chatId)) {
      return NextResponse.json({ success: false, message: 'Invalid chat ID' }, { status: 400 })
    }

    // Get employee ID from authenticated user
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const employeeId = user.employeeId._id || user.employeeId
    if (!isValidObjectId(employeeId.toString())) {
      return NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 })
    }

    // Get employee details
    const employee = await Employee.findById(employeeId)
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Fetch chat and verify user is a participant
    const chat = await Chat.findById(chatId)
      .populate('messages.sender', 'firstName lastName profilePicture employeeCode')
      .populate('messages.mentions', 'firstName lastName profilePicture employeeCode')

    if (!chat) {
      return NextResponse.json({ success: false, message: 'Chat not found' }, { status: 404 })
    }

    // Check if user is a participant
    const isParticipant = chat.participants.some(p => p.toString() === employee._id.toString())
    if (!isParticipant) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 403 })
    }

    // Manually populate replyTo messages (since they're subdocuments)
    const messagesWithReplies = chat.messages.map(msg => {
      const msgObj = msg.toObject()
      if (msgObj.replyTo) {
        const replyToMessage = chat.messages.id(msgObj.replyTo)
        if (replyToMessage) {
          msgObj.replyTo = {
            _id: replyToMessage._id,
            content: replyToMessage.content,
            fileName: replyToMessage.fileName,
            sender: replyToMessage.sender
          }
        }
      }
      return msgObj
    })

    return NextResponse.json({
      success: true,
      data: messagesWithReplies
    })
  } catch (error) {
    console.error('Get messages error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// POST - Send a message
export async function POST(request, context) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Chat', 'Employee', 'User', 'Notification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Chat, Employee, User, Notification } = models

    const params = await context.params
    const { chatId } = params
    const body = await request.json().catch(() => ({}))
    const { content, fileUrl, fileId, fileName, fileType, fileSize, replyTo, mentions } = body

    if (!isValidObjectId(chatId)) {
      return NextResponse.json({ success: false, message: 'Invalid chat ID' }, { status: 400 })
    }

    // Get employee ID from authenticated user
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Extract employee ID properly (handle both populated object and raw ObjectId)
    const employeeId = user.employeeId._id || user.employeeId
    if (!isValidObjectId(employeeId.toString())) {
      return NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 })
    }
    const employeeIdStr = employeeId.toString()

    // Get employee details
    const employee = await Employee.findById(employeeId)
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Fetch chat and verify user is a participant
    const chat = await Chat.findById(chatId)
    if (!chat) {
      return NextResponse.json({ success: false, message: 'Chat not found' }, { status: 404 })
    }

    // Check if user is a participant (compare Employee IDs)
    const isParticipant = chat.participants.some(p => p.toString() === employeeIdStr)
    if (!isParticipant) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 403 })
    }

    // Normalize + validate mentions (Employee IDs only)
    const participantSet = new Set(chat.participants.map(p => p.toString()))
    const mentionIds = Array.isArray(mentions)
      ? [...new Set(mentions.map(m => m?.toString?.()).filter(Boolean))]
      : []
    const safeMentionIds = mentionIds.filter(id => participantSet.has(id) && isValidObjectId(id))

    // Create message
    const message = {
      sender: employee._id,
      content: content || '',
      createdAt: new Date(),
      // Mark as read by sender immediately
      isRead: [{
        user: employee._id,
        readAt: new Date()
      }]
    }

    if (safeMentionIds.length > 0) {
      message.mentions = safeMentionIds
    }

    // Add file info if present
    if (fileUrl) {
      message.fileUrl = fileUrl
      message.fileId = fileId // ImageKit file ID for deletion
      message.fileName = fileName
      message.fileType = fileType
      message.fileSize = fileSize
    }

    // Add reply reference if present
    if (replyTo) {
      const replyToId = replyTo?.toString?.()
      if (!replyToId || !isValidObjectId(replyToId)) {
        return NextResponse.json({ success: false, message: 'Invalid reply message ID' }, { status: 400 })
      }
      message.replyTo = replyToId
    }

    // Add message to chat
    chat.messages.push(message)
    // lastMessage is a string with the message content preview
    chat.lastMessage = content || fileName || 'File'
    chat.lastMessageAt = new Date()

    await chat.save()

    // Populate the new message
    const updatedChat = await Chat.findById(chatId)
      .populate('messages.sender', 'firstName lastName profilePicture employeeCode')
      .populate('messages.mentions', 'firstName lastName profilePicture employeeCode')
      .populate('participants', 'firstName lastName')

    let newMessage = updatedChat.messages[updatedChat.messages.length - 1].toObject()

    // Manually populate replyTo if it exists
    if (newMessage.replyTo) {
      const replyToMessage = updatedChat.messages.id(newMessage.replyTo)
      if (replyToMessage) {
        newMessage.replyTo = {
          _id: replyToMessage._id,
          content: replyToMessage.content,
          fileName: replyToMessage.fileName,
          sender: replyToMessage.sender
        }
      }
    }

    // Broadcast message via WebSocket (server-side)
    try {
      const io = global.io

      if (io) {
        // Broadcast to the chat room (for users actively viewing the chat)
        io.to(`chat:${chatId}`).emit('new-message', {
          chatId,
          message: newMessage,
          senderId: employeeIdStr  // Use Employee ID for consistency
        })

        // Get User IDs for WebSocket rooms (socket rooms use User._id)
        const participantEmployeeIds = chat.participants.map(p => p.toString())
        const participantUsers = await User.find({
          employeeId: { $in: participantEmployeeIds }
        }).select('_id employeeId')

        // Broadcast to each participant's personal room (for notifications and unread counts)
        participantUsers.forEach(participantUser => {
          const participantEmployeeIdStr = participantUser.employeeId.toString()
          // Don't send to the sender's personal room (they already have the message)
          if (participantEmployeeIdStr !== employeeIdStr) {
            // Socket rooms use User._id, not Employee._id
            io.to(`user:${participantUser._id.toString()}`).emit('new-message', {
              chatId,
              message: newMessage,
              senderId: employeeIdStr
            })
            console.log(`💬 [WebSocket] Sent message to user:${participantUser._id.toString()} (employee: ${participantEmployeeIdStr})`)
          }
        })

        console.log(`💬 [WebSocket] Broadcasted message to chat:${chatId} and ${participantUsers.length - 1} participant(s)`)
      } else {
        console.warn('⚠️ [WebSocket] Socket.IO instance not available')
      }
    } catch (socketError) {
      console.error('[WebSocket] Failed to broadcast message:', socketError)
    }

    // Send push notifications to other participants (not the sender)
    try {
      // Filter out sender from participants (compare Employee IDs)
      const otherParticipantIds = chat.participants
        .map(p => p.toString())
        .filter(pId => pId !== employeeIdStr)
      
      console.log(`[Chat Notification] Other participants count: ${otherParticipantIds.length}`)

      if (otherParticipantIds.length > 0) {
        // Get User IDs from Employee IDs
        const recipientUsers = await User.find({
          employeeId: { $in: otherParticipantIds }
        }).select('_id')

        const recipientUserIds = recipientUsers.map(u => u._id.toString())
        console.log(`[Chat Notification] Recipient user IDs: ${recipientUserIds.join(', ')}`)

        if (recipientUserIds.length > 0) {
          // Send Firebase notification to each recipient
          for (const recipientId of recipientUserIds) {
            await sendMessageNotification({
              senderId: user._id.toString(),  // User._id for notification system
              recipientId,
              message: content || fileName || 'Sent a file',
              chatId,
              models: { User, Employee, Notification }
            })
          }

          console.log(`[Chat Notification] Firebase notifications sent to ${recipientUserIds.length} recipient(s)`)
        } else {
          console.log(`[Chat Notification] No recipient user IDs found`)
        }
      } else {
        console.log(`[Chat Notification] No other participants to notify`)
      }
    } catch (notifError) {
      // Don't fail the message send if notification fails
      console.error('[Chat Notification] Failed to send push notification:', notifError)
    }

    return NextResponse.json({
      success: true,
      data: newMessage,
      message: 'Message sent successfully'
    })
  } catch (error) {
    console.error('Send message error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

