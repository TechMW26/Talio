import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) &&
    (new mongoose.Types.ObjectId(id)).toString() === id
}
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

    if (!isValidObjectId(chatId)) {
      return NextResponse.json({ success: false, message: 'Invalid chat ID' }, { status: 400 })
    }

    // Get user's employee ID from authenticated user
    if (!user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const employeeId = user.employeeId._id || user.employeeId
    if (!isValidObjectId(employeeId.toString())) {
      return NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 })
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
      p => p._id.toString() === employeeId.toString()
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

// POST - Leave a chat (remove current user from participants)
export async function POST(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Chat', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Chat, Employee } = models

    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const employeeId = user.employeeId._id || user.employeeId
    if (!isValidObjectId(employeeId.toString())) {
      return NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 })
    }
    const employee = await Employee.findById(employeeId)
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const { chatId } = await params
    if (!isValidObjectId(chatId)) {
      return NextResponse.json({ success: false, message: 'Invalid chat ID' }, { status: 400 })
    }
    const chat = await Chat.findById(chatId)
    if (!chat) {
      return NextResponse.json({ success: false, message: 'Chat not found' }, { status: 404 })
    }

    const isParticipant = chat.participants.some(p => p.toString() === employee._id.toString())
    if (!isParticipant) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    // Remove participant
    chat.participants = chat.participants.filter(p => p.toString() !== employee._id.toString())

    // If group and admin left, pick a new admin (best-effort)
    if (chat.isGroup && chat.admin && chat.admin.toString() === employee._id.toString()) {
      chat.admin = chat.participants[0] || undefined
    }

    // If no participants remain, delete the chat
    if (!chat.participants || chat.participants.length === 0) {
      await Chat.findByIdAndDelete(chat._id)
      return NextResponse.json({ success: true, message: 'Chat removed' })
    }

    await chat.save()
    return NextResponse.json({ success: true, message: 'Left chat' })
  } catch (error) {
    console.error('Leave chat error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// DELETE - Delete a chat (group: admin only; direct: behaves like leave)
export async function DELETE(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Chat', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Chat, Employee } = models

    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const employeeId = user.employeeId._id || user.employeeId
    if (!isValidObjectId(employeeId.toString())) {
      return NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 })
    }
    const employee = await Employee.findById(employeeId)
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const { chatId } = await params
    if (!isValidObjectId(chatId)) {
      return NextResponse.json({ success: false, message: 'Invalid chat ID' }, { status: 400 })
    }
    const chat = await Chat.findById(chatId)
    if (!chat) {
      return NextResponse.json({ success: false, message: 'Chat not found' }, { status: 404 })
    }

    const isParticipant = chat.participants.some(p => p.toString() === employee._id.toString())
    if (!isParticipant) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    // For direct chats, treat "delete" as "leave" (remove from my list)
    if (!chat.isGroup) {
      chat.participants = chat.participants.filter(p => p.toString() !== employee._id.toString())
      if (!chat.participants || chat.participants.length === 0) {
        await Chat.findByIdAndDelete(chat._id)
      } else {
        await chat.save()
      }
      return NextResponse.json({ success: true, message: 'Chat removed' })
    }

    // For group chats, only admin can delete.
    if (!chat.admin || chat.admin.toString() !== employee._id.toString()) {
      return NextResponse.json({ success: false, message: 'Only admin can delete this group chat' }, { status: 403 })
    }

    await Chat.findByIdAndDelete(chat._id)
    return NextResponse.json({ success: true, message: 'Chat deleted' })
  } catch (error) {
    console.error('Delete chat error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
