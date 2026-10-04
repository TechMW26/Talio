import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { CHAT_STORE_OPTIONS, requireChat } from '@/lib/chat.server'
import { getPusherServer } from '@/lib/pusherServer'
import { roomToPusherChannel } from '@/lib/platform/realtimeChannels'
import { rateLimit, buildRateLimitHeaders } from '@/lib/security/rateLimiter'

export const runtime = 'nodejs'
const EVENTS = { typing: 'user-typing', 'stop-typing': 'user-stop-typing', 'mark-read': 'message-read' }

// Only transient chat hints enter here. Message content is published by the
// authenticated message API after persistence, never by an arbitrary client.
export async function POST(request) {
  const auth = await getAuthAndDatabase(request, CHAT_STORE_OPTIONS)
  if (!auth.success) return NextResponse.json({ message: auth.message }, { status: 401 })
  let body
  try { body = await request.json() } catch { return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 }) }
  const { event, chatId, messageId } = body || {}
  if (!Object.hasOwn(EVENTS, event) || !/^[a-f\d]{24}$/i.test(String(chatId))) {
    return NextResponse.json({ message: 'Invalid realtime event' }, { status: 400 })
  }
  const userId = String(auth.user._id || auth.user.userId)
  const limit = await rateLimit('REALTIME_HINT', `${auth.tenant.databaseName}:${userId}`, { record: false })
  if (!limit.allowed) return NextResponse.json({ message: 'Too many realtime events' }, {
    status: 429, headers: buildRateLimitHeaders(limit),
  })
  try {
    const { employee } = await requireChat(auth.database, auth.user, chatId)
    if (process.env.TALIO_LOCAL_ACCEPTANCE !== '1') await getPusherServer().trigger(roomToPusherChannel(`chat:${chatId}`, auth.tenant.databaseName), EVENTS[event], {
      chatId, userId,
      userName: employee ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim() : 'Team member',
      ...(event === 'mark-read' && /^[a-f\d]{24}$/i.test(String(messageId)) ? { messageId } : {}),
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error.status) return NextResponse.json({ message: error.message }, { status: error.status })
    console.error('[RealtimeEvent] Failed:', error.message)
    return NextResponse.json({ message: 'Realtime delivery unavailable' }, { status: 503 })
  }
}
