import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'

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

    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      )
    }

    // Validate session ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { error: 'Invalid session ID format' },
        { status: 400 }
      )
    }

    // Get user ID - could be ObjectId or string from cache
    const userId = user._id || user.userId
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId

    // Find the session and ensure it belongs to the current user
    const session = await UserSession.findOne({
      _id: new mongoose.Types.ObjectId(id),
      user: userObjectId,
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
    const currentTokenId = user.tokenId || null
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

    console.log(`[sessions] Revoked session ${id} for user ${user._id || user.userId}`)

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
