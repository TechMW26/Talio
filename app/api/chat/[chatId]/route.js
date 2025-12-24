import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import Chat from '@/models/Chat'
import User from '@/models/User'

// GET - Fetch a single chat by ID
export async function GET(request, context) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    await connectDB()

    const { chatId } = await context.params

    // Get user's employee ID
    const user = await User.findById(decoded.userId).select('employeeId')
    if (!user || !user.employeeId) {
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
      p => p._id.toString() === user.employeeId.toString()
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
