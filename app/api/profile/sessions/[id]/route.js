import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'

// DELETE - Revoke a specific session
export async function DELETE(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['UserSession'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { UserSession } = models

    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      )
    }

    // Find the session and ensure it belongs to the current user
    const session = await UserSession.findOne({
      _id: id,
      user: payload.userId,
    })

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    if (!session.isActive) {
      return NextResponse.json(
        { error: 'Session is already revoked' },
        { status: 400 }
      )
    }

    // Check if trying to revoke current session
    const currentTokenId = payload.tokenId || null
    if (currentTokenId && session.tokenId === currentTokenId) {
      return NextResponse.json(
        { error: 'Cannot revoke your current session. Use logout instead.' },
        { status: 400 }
      )
    }

    // Revoke the session
    session.isActive = false
    session.revokedAt = new Date()
    session.revokedReason = 'user_logout'
    await session.save()

    console.log(`[sessions] Revoked session ${id} for user ${payload.userId}`)

    return NextResponse.json({
      success: true,
      message: 'Session has been revoked',
    })
  } catch (error) {
    console.error('[sessions] Error revoking session:', error)
    return NextResponse.json(
      { error: 'Failed to revoke session' },
      { status: 500 }
    )
  }
}
