import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getAuthAndModels } from '@/lib/auth'
import { getPusherServer } from '@/lib/pusherServer'
import { roomToPusherChannel } from '@/lib/platform/realtimeChannels'
import { rateLimit, buildRateLimitHeaders } from '@/lib/security/rateLimiter'

export const runtime = 'nodejs'
const EVENTS = { typing: 'user-typing', 'stop-typing': 'user-stop-typing', 'mark-read': 'message-read' }

// Only transient chat hints enter here. Message content is published by the
// authenticated message API after persistence, never by an arbitrary client.
export async function POST(request) {
  const auth = await getAuthAndModels(request, ['Chat', 'User', 'Employee'])
  if (!auth.success) return NextResponse.json({ message: auth.message }, { status: 401 })
  let body
  try { body = await request.json() } catch { return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 }) }
  const { event, chatId, messageId } = body || {}
  if (!Object.hasOwn(EVENTS, event) || !mongoose.isValidObjectId(chatId)) {
    return NextResponse.json({ message: 'Invalid realtime event' }, { status: 400 })
  }
  const userId = String(auth.user._id || auth.user.userId)
  const limit = await rateLimit('REALTIME_HINT', `${auth.tenant.databaseName}:${userId}`, { record: false })
  if (!limit.allowed) return NextResponse.json({ message: 'Too many realtime events' }, {
    status: 429, headers: buildRateLimitHeaders(limit),
  })
  try {
    const chat = await auth.models.Chat.findById(chatId).select('participants').lean()
    if (!chat || !(chat.participants || []).some(member => String(member?._id || member) === userId)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
    }
    const user = await auth.models.User.findById(userId).select('employeeId').lean()
    const employee = user?.employeeId
      ? await auth.models.Employee.findById(user.employeeId).select('firstName lastName').lean()
      : null
    await getPusherServer().trigger(roomToPusherChannel(`chat:${chatId}`), EVENTS[event], {
      chatId, userId,
      userName: employee ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim() : 'Team member',
      ...(event === 'mark-read' && mongoose.isValidObjectId(messageId) ? { messageId } : {}),
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[RealtimeEvent] Failed:', error.message)
    return NextResponse.json({ message: 'Realtime delivery unavailable' }, { status: 503 })
  }
}
