import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
export async function DELETE(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Chat', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Chat, Employee } = models

    const { chatId, messageId } = params

    // Get employee ID from authenticated user
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 })
    }

    const employeeId = user.employeeId._id || user.employeeId

    // Get employee details
    const employee = await Employee.findById(employeeId)
    if (!employee) {
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
    if (message.sender.toString() !== employee._id.toString()) {
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

