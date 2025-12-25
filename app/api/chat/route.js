import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
// GET - Fetch all chats for the current user
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Chat', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Chat, User } = models

    // Get user's employee ID
    const user = await User.findById(decoded.userId).select('employeeId')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Fetch all chats where user is a participant
    const chats = await Chat.find({
      participants: user.employeeId
    })
      .populate('participants', 'firstName lastName profilePicture employeeCode')
      .populate('admin', 'firstName lastName')
      .populate('messages.sender', 'firstName lastName profilePicture')
      .sort({ lastMessageAt: -1 })

    return NextResponse.json({
      success: true,
      data: chats,
      currentUserId: user.employeeId.toString()
    })
  } catch (error) {
    console.error('Get chats error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// POST - Create a new chat (direct or group)
export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Get user's employee ID
    const user = await User.findById(decoded.userId).select('employeeId')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const body = await request.json()
    const { isGroup, participants, name } = body

    // Validate participants
    if (!participants || participants.length === 0) {
      return NextResponse.json({ success: false, message: 'Participants are required' }, { status: 400 })
    }

    // For direct chat, check if chat already exists
    if (!isGroup) {
      if (participants.length !== 1) {
        return NextResponse.json({ success: false, message: 'Direct chat must have exactly one other participant' }, { status: 400 })
      }

      const existingChat = await Chat.findOne({
        isGroup: false,
        participants: { $all: [user.employeeId, participants[0]] }
      })

      if (existingChat) {
        return NextResponse.json({
          success: true,
          data: existingChat,
          message: 'Chat already exists'
        })
      }
    }

    // Create new chat
    const chatData = {
      isGroup,
      participants: isGroup ? [...participants, user.employeeId] : [user.employeeId, participants[0]],
      createdBy: user.employeeId,
      messages: []
    }

    if (isGroup) {
      if (!name) {
        return NextResponse.json({ success: false, message: 'Group name is required' }, { status: 400 })
      }
      chatData.name = name
      chatData.admin = user.employeeId
    }

    const chat = await Chat.create(chatData)

    const populatedChat = await Chat.findById(chat._id)
      .populate('participants', 'firstName lastName profilePicture employeeCode')
      .populate('admin', 'firstName lastName')

    return NextResponse.json({
      success: true,
      data: populatedChat,
      message: 'Chat created successfully'
    })
  } catch (error) {
    console.error('Create chat error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

