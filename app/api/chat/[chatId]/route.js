import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
// GET - Fetch a single chat by ID
export async function GET(request, context) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Chat'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Chat } = models

    const { chatId } = await context.params

    // Get user's employee ID from authenticated user
    if (!user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Fetch the chat
    const chat = await Chat.findById(chatId)
      .populate('participants', 'firstName lastName profilePicture employeeCode')
      .populate('admin', 'firstName lastName')
      .select('-messages') // Don't include messages for performance

    if (!chat) {
      return NextResponse.json({ success: false, message: 'Chat not found' }, { status: 404 })
    }

    // Verify user is a participant
    const isParticipant = chat.participants.some(
      p => p._id.toString() === user.employeeId._id.toString()
    )

    if (!isParticipant) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    return NextResponse.json(chat)
  } catch (error) {
    console.error('Get chat error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
