import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { REALTIME_EVENTS } from '@/lib/realtimeEvents'

/**
 * POST /api/tictactoe — Send a game invite, relay a move, accept/decline/end
 * Body: { action, targetUserId, ...payload }
 * Actions: invite | accept | decline | move | end
 */
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['Employee'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const body = await request.json()
    const { action, targetUserId, ...payload } = body

    if (!action) {
      return NextResponse.json({ success: false, message: 'action is required' }, { status: 400 })
    }

    const io = global.io
    if (!io) {
      return NextResponse.json({ success: false, message: 'Real-time not available' }, { status: 503 })
    }

    // Get sender info
    const { Employee } = auth.models
    const senderEmployee = await Employee.findById(auth.user.employeeId).select('firstName lastName avatar').lean()
    const senderName = senderEmployee ? `${senderEmployee.firstName} ${senderEmployee.lastName}` : 'Someone'
    const senderAvatar = senderEmployee?.avatar || null

    const eventMap = {
      invite: REALTIME_EVENTS.TICTACTOE_INVITE,
      accept: REALTIME_EVENTS.TICTACTOE_ACCEPT,
      decline: REALTIME_EVENTS.TICTACTOE_DECLINE,
      move: REALTIME_EVENTS.TICTACTOE_MOVE,
      end: REALTIME_EVENTS.TICTACTOE_END,
    }

    const eventName = eventMap[action]
    if (!eventName) {
      return NextResponse.json({ success: false, message: 'Invalid action' }, { status: 400 })
    }

    if (!targetUserId) {
      return NextResponse.json({ success: false, message: 'targetUserId is required' }, { status: 400 })
    }

    const eventData = {
      ...payload,
      fromUserId: auth.user.userId,
      fromName: senderName,
      fromAvatar: senderAvatar,
      targetUserId,
      timestamp: new Date().toISOString(),
    }

    // Emit to the target user
    io.to(`user:${targetUserId}`).emit(eventName, eventData)

    // For moves/accept/end, also emit back to the sender so both sides stay synced
    if (['accept', 'move', 'end'].includes(action)) {
      io.to(`user:${auth.user.userId}`).emit(eventName, eventData)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[TicTacToe API] Error:', error)
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 })
  }
}
