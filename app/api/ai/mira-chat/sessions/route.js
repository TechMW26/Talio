import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

// GET — list all sessions for the user (titles + ids, sorted by recent)
export async function GET(request) {
  try {
    const { success, user, models, message } = await getAuthAndModels(request, ['MiraChatSession'])
    if (!success) return NextResponse.json({ success: false, message }, { status: 401 })

    const sessions = await models.MiraChatSession.find({ user: user._id })
      .select('title lastMessageAt createdAt')
      .sort({ lastMessageAt: -1 })
      .lean()
      .limit(50)

    return NextResponse.json({ success: true, sessions })
  } catch (error) {
    console.error('[Mira Sessions] List error:', error)
    return NextResponse.json({ success: false, message: 'Failed to load sessions' }, { status: 500 })
  }
}

// POST — create a new session
export async function POST(request) {
  try {
    const { success, user, models, message } = await getAuthAndModels(request, ['MiraChatSession'])
    if (!success) return NextResponse.json({ success: false, message }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const title = body.title?.trim() || 'New Chat'

    const session = await models.MiraChatSession.create({
      user: user._id,
      title,
      messages: [],
      lastMessageAt: new Date()
    })

    return NextResponse.json({
      success: true,
      session: { _id: session._id, title: session.title, lastMessageAt: session.lastMessageAt, createdAt: session.createdAt }
    })
  } catch (error) {
    console.error('[Mira Sessions] Create error:', error)
    return NextResponse.json({ success: false, message: 'Failed to create session' }, { status: 500 })
  }
}
