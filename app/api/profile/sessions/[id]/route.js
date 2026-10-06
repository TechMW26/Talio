import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'

// DELETE - Revoke a specific session
export async function DELETE(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, database } = auth

    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      )
    }

    // Validate session ID format
    if (!/^[a-f\d]{24}$/i.test(id)) {
      return NextResponse.json(
        { error: 'Invalid session ID format' },
        { status: 400 }
      )
    }

    const userId = String(user._id || user.userId)

    // Find the session and ensure it belongs to the current user
    const session = await database.get('usersessions', id)

    if (!session || String(session.user) !== userId) {
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
    await database.mutate('usersessions', id, current => {
      if (String(current.user) !== userId || (currentTokenId && current.tokenId === currentTokenId)) throw new Error('Session ownership changed')
      return { ...current, isActive: false, revokedAt: new Date(), revokedReason: 'user_logout', updatedAt: new Date() }
    })

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
