import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

// GET - load a session with all messages
export async function GET(request, { params }) {
  try {
    const { id } = await params
    const { success, user, models, message } = await getAuthAndModels(request, ['MiraChatSession'])
    if (!success) return NextResponse.json({ success: false, message }, { status: 401 })

    const session = await models.MiraChatSession.findOne({ _id: id, user: user._id }).lean()
    if (!session) return NextResponse.json({ success: false, message: 'Session not found' }, { status: 404 })

    return NextResponse.json({ success: true, session })
  } catch (error) {
    console.error('[Mira Sessions] Get error:', error)
    return NextResponse.json({ success: false, message: 'Failed to load session' }, { status: 500 })
  }
}

// PATCH - update session (add messages, rename)
export async function PATCH(request, { params }) {
  try {
    const { id } = await params
    const { success, user, models, message } = await getAuthAndModels(request, ['MiraChatSession'])
    if (!success) return NextResponse.json({ success: false, message }, { status: 401 })

    const body = await request.json()
    const update = {}

    // Rename title
    if (body.title) update.title = body.title.trim()

    // Append messages
    if (body.messages?.length > 0) {
      update.$push = { messages: { $each: body.messages } }
      update.lastMessageAt = new Date()
    }

    // Auto-generate title from first user message if still default
    if (body.autoTitle && body.messages?.length > 0) {
      const session = await models.MiraChatSession.findOne({ _id: id, user: user._id }).select('title messages').lean()
      if (session && (session.title === 'New Chat' || !session.title) && session.messages.length === 0) {
        const firstUserMsg = body.messages.find(m => m.role === 'user')
        if (firstUserMsg) {
          update.title = firstUserMsg.content.length > 50
            ? firstUserMsg.content.substring(0, 50) + '...'
            : firstUserMsg.content
        }
      }
    }

    const updated = await models.MiraChatSession.findOneAndUpdate(
      { _id: id, user: user._id },
      update,
      { new: true }
    ).lean()

    if (!updated) return NextResponse.json({ success: false, message: 'Session not found' }, { status: 404 })

    return NextResponse.json({
      success: true,
      session: { _id: updated._id, title: updated.title, lastMessageAt: updated.lastMessageAt }
    })
  } catch (error) {
    console.error('[Mira Sessions] Update error:', error)
    return NextResponse.json({ success: false, message: 'Failed to update session' }, { status: 500 })
  }
}

// DELETE - delete a session
export async function DELETE(request, { params }) {
  try {
    const { id } = await params
    const { success, user, models, message } = await getAuthAndModels(request, ['MiraChatSession'])
    if (!success) return NextResponse.json({ success: false, message }, { status: 401 })

    const deleted = await models.MiraChatSession.findOneAndDelete({ _id: id, user: user._id })
    if (!deleted) return NextResponse.json({ success: false, message: 'Session not found' }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Mira Sessions] Delete error:', error)
    return NextResponse.json({ success: false, message: 'Failed to delete session' }, { status: 500 })
  }
}
