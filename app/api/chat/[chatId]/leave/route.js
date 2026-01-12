import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

// POST /api/chat/:chatId/leave
// Kept as a dedicated route because the mobile client calls it explicitly.
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
    const employee = await Employee.findById(employeeId)
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

  const { chatId } = await params

    const chat = await Chat.findById(chatId)
    if (!chat) {
      return NextResponse.json({ success: false, message: 'Chat not found' }, { status: 404 })
    }

    const isParticipant = chat.participants.some(p => p.toString() === employee._id.toString())
    if (!isParticipant) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    chat.participants = chat.participants.filter(p => p.toString() !== employee._id.toString())

    if (chat.isGroup && chat.admin && chat.admin.toString() === employee._id.toString()) {
      chat.admin = chat.participants[0] || undefined
    }

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
