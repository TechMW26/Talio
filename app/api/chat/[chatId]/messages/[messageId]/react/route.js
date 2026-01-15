import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) &&
    (new mongoose.Types.ObjectId(id)).toString() === id
}

export async function POST(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Chat'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Chat } = models

    const { chatId, messageId } = params
    const body = await request.json().catch(() => ({}))
    const { reaction } = body

    if (!isValidObjectId(chatId) || !isValidObjectId(messageId)) {
      return NextResponse.json({ success: false, error: 'Invalid chat or message ID' }, { status: 400 })
    }

    if (!reaction || typeof reaction !== 'string') {
      return NextResponse.json({ success: false, error: 'Reaction is required' }, { status: 400 })
    }

    // Find the chat and message
    const chat = await Chat.findById(chatId)
    if (!chat) {
      return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
    }

    // Find the message
    const message = chat.messages.id(messageId)
    if (!message) {
      return NextResponse.json({ success: false, error: 'Message not found' }, { status: 404 })
    }

    // Initialize reactions array if it doesn't exist
    if (!message.reactions) {
      message.reactions = []
    }

    const userId = user._id || user.userId
    if (!userId || !isValidObjectId(userId.toString())) {
      return NextResponse.json({ success: false, error: 'Invalid user ID' }, { status: 400 })
    }

    // Check if user already reacted with this emoji
    const existingReactionIndex = message.reactions.findIndex(
      r => r.user.toString() === userId.toString() && r.reaction === reaction
    )

    if (existingReactionIndex > -1) {
      // Remove reaction if already exists (toggle)
      message.reactions.splice(existingReactionIndex, 1)
    } else {
      // Remove any other reaction from this user first
      message.reactions = message.reactions.filter(
        r => r.user.toString() !== userId.toString()
      )
      // Add new reaction
      message.reactions.push({
        user: userId,
        reaction,
        createdAt: new Date()
      })
    }

    await chat.save()

    // Populate sender for response
    await chat.populate('messages.sender', 'firstName lastName avatar')
    await chat.populate('messages.replyTo.sender', 'firstName lastName')
    
    const updatedMessage = chat.messages.id(messageId)

    // Broadcast reaction update via Socket.IO
    const io = (await import('@/lib/socket')).getIO()
    if (io) {
      io.to(`chat:${chatId}`).emit('message-reaction', {
        chatId,
        messageId,
        message: updatedMessage
      })
    }

    return NextResponse.json({ success: true, data: updatedMessage })
  } catch (error) {
    console.error('Error adding reaction:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

