import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) &&
    (new mongoose.Types.ObjectId(id)).toString() === id
}
// GET - Fetch all chats for the current user
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Chat', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Chat } = models

    // Check user's employee ID
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Extract employee ID properly (handle both populated object and raw ObjectId)
    const employeeId = user.employeeId._id || user.employeeId
    if (!isValidObjectId(employeeId.toString())) {
      return NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 })
    }
    const employeeIdStr = employeeId.toString()

    // Fetch all chats where user is a participant
    const chats = await Chat.find({
      participants: employeeId
    })
      .populate('participants', 'firstName lastName profilePicture employeeCode')
      .populate('admin', 'firstName lastName')
      .populate('messages.sender', 'firstName lastName profilePicture')
      .sort({ lastMessageAt: -1 })

    return NextResponse.json({
      success: true,
      data: chats,
      currentUserId: employeeIdStr
    })
  } catch (error) {
    console.error('Get chats error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// POST - Create a new chat (direct or group)
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Chat'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Chat } = models

    // Check user's employee ID
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Extract employee ID properly (handle both populated object and raw ObjectId)
    const employeeId = user.employeeId._id || user.employeeId
    if (!isValidObjectId(employeeId.toString())) {
      return NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 })
    }
    const employeeIdStr = employeeId.toString()

  const body = await request.json().catch(() => ({}))
  const { isGroup, participants, name } = body

    // Validate participants
    if (!participants || participants.length === 0) {
      return NextResponse.json({ success: false, message: 'Participants are required' }, { status: 400 })
    }

    const normalizedParticipants = participants
      .map(id => id?.toString?.())
      .filter(Boolean)

    if (normalizedParticipants.some(id => !isValidObjectId(id))) {
      return NextResponse.json({ success: false, message: 'Invalid participant ID' }, { status: 400 })
    }

    // For direct chat, check if chat already exists
    if (!isGroup) {
      if (normalizedParticipants.length !== 1) {
        return NextResponse.json({ success: false, message: 'Direct chat must have exactly one other participant' }, { status: 400 })
      }

      const existingChat = await Chat.findOne({
        isGroup: false,
        participants: { $all: [employeeId, normalizedParticipants[0]] }
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
  participants: isGroup ? [...normalizedParticipants, employeeId] : [employeeId, normalizedParticipants[0]],
      createdBy: employeeId,
      messages: []
    }

    if (isGroup) {
      if (!name) {
        return NextResponse.json({ success: false, message: 'Group name is required' }, { status: 400 })
      }
      chatData.name = name
      chatData.admin = employeeId
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

