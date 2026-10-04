import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getNativeAuthRepository } from '@/lib/platform/firestoreAuth.server'

// GET - List all active sessions for current user
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user } = auth
    const repository = await getNativeAuthRepository(auth.tenant.databaseName)

    // Get current session's token ID if available
    const currentTokenId = user.tokenId || null
    const userId = String(user._id || user.userId)

    // Fetch all active sessions for this user
    const sessions = (await repository.listUserSessions(userId))
      .filter(session => session.isActive && new Date(session.expiresAt).getTime() > Date.now() && (Number(session.authVersion) || 0) === (Number(user.authVersion) || 0))
      .sort((a, b) => new Date(b.lastActivityAt || 0) - new Date(a.lastActivityAt || 0))

    // Format sessions for response
    const formattedSessions = sessions.map((session) => ({
      id: session._id.toString(),
      deviceInfo: session.deviceInfo,
      ipAddress: session.ipAddress,
      location: session.location,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      isCurrent: currentTokenId && session.tokenId === currentTokenId,
    }))

    return NextResponse.json({
      success: true,
      sessions: formattedSessions,
      count: formattedSessions.length,
    })
  } catch (error) {
    console.error('[sessions] Error fetching sessions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sessions' },
      { status: 500 }
    )
  }
}

// DELETE - Revoke all sessions except current
export async function DELETE(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user } = auth
    const repository = await getNativeAuthRepository(auth.tenant.databaseName)

    const currentTokenId = user.tokenId || null
    const userId = String(user._id || user.userId)
    const sessions = (await repository.listUserSessions(userId)).filter(session => session.isActive && session.tokenId !== currentTokenId)
    let revokedCount = 0
    for (let offset = 0; offset < sessions.length; offset += 50) {
      revokedCount += await repository.database.transaction(async tx => {
        let count = 0
        for (const found of sessions.slice(offset, offset + 50)) {
          const session = await tx.get('usersessions', found._id)
          if (!session?.isActive || String(session.user) !== userId || session.tokenId === currentTokenId) continue
          await tx.replace('usersessions', { ...session, isActive: false, revokedAt: new Date(), revokedReason: 'user_logout' })
          count++
        }
        return count
      })
    }

    return NextResponse.json({
      success: true,
      message: `Logged out from ${revokedCount} other device(s)`,
      revokedCount,
    })
  } catch (error) {
    console.error('[sessions] Error revoking sessions:', error)
    return NextResponse.json(
      { error: 'Failed to revoke sessions' },
      { status: 500 }
    )
  }
}
