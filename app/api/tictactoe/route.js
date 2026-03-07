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
    if (!targetUserId) {
      return NextResponse.json({ success: false, message: 'targetUserId is required' }, { status: 400 })
    }

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

    // Sender's user ID — use _id which is always present
    const senderId = (auth.user._id || auth.user.id || auth.user.userId).toString()

    // Get sender info
    const { Employee } = auth.models
    let senderName = 'Someone'
    let senderAvatar = null
    if (auth.user.employeeId) {
      const senderEmployee = await Employee.findById(auth.user.employeeId).select('firstName lastName avatar').lean()
      if (senderEmployee) {
        senderName = `${senderEmployee.firstName} ${senderEmployee.lastName}`.trim()
        senderAvatar = senderEmployee.avatar || null
      }
    }

    const eventData = {
      ...payload,
      fromUserId: senderId,
      fromName: senderName,
      fromAvatar: senderAvatar,
      targetUserId,
      timestamp: new Date().toISOString(),
    }

    const io = global.io
    if (!io) {
      console.warn('[TicTacToe API] global.io not available — are you running the custom server?')
      return NextResponse.json({ success: false, message: 'Real-time not available. Use npm run dev (custom server).' }, { status: 503 })
    }

    console.log(`[TicTacToe API] ${action} from ${senderId} to ${targetUserId}`)

    // Emit to the target user
    io.to(`user:${targetUserId}`).emit(eventName, eventData)

    // For moves/accept/end, also emit back to the sender so both sides stay synced
    if (['accept', 'move', 'end'].includes(action)) {
      io.to(`user:${senderId}`).emit(eventName, eventData)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[TicTacToe API] Error:', error)
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 })
  }
}
