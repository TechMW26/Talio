import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
export async function DELETE(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Chat', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Chat, User, Employee } = models

    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const decoded = verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 401 })
    }

    const { chatId, messageId } = params

    // Get user to find employee ID
    const userDoc = await User.findById(decoded.userId).select('employeeId')
    if (!userDoc || !userDoc.employeeId) {
      return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 })
    }

    // Get employee details
    const user = await Employee.findById(userDoc.employeeId)
    if (!user) {
      return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 })
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

    // Check if user is the sender
    if (message.sender.toString() !== user._id.toString()) {
      return NextResponse.json({ success: false, error: 'You can only delete your own messages' }, { status: 403 })
    }

    // Remove the message
    message.deleteOne()
    await chat.save()

    // Broadcast deletion via Socket.IO
    const io = (await import('@/lib/socket')).getIO()
    if (io) {
      io.to(`chat:${chatId}`).emit('message-deleted', {
        chatId,
        messageId
      })
    }

    return NextResponse.json({ success: true, message: 'Message deleted' })
  } catch (error) {
    console.error('Error deleting message:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

