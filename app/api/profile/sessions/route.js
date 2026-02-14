import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'

// Helper to ensure user ID is ObjectId
function getUserObjectId(user) {
  const userId = user._id || user.userId
  return typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId
}

// GET - List all active sessions for current user
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['UserSession'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { UserSession } = models

    // Get current session's token ID if available
    const currentTokenId = user.tokenId || null
    const userObjectId = getUserObjectId(user)

    // Fetch all active sessions for this user
    const sessions = await UserSession.find({
      user: userObjectId,
      isActive: true,
      expiresAt: { $gt: new Date() },
    })
      .sort({ lastActivityAt: -1 })
      .lean()

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
    const auth = await getAuthAndModels(request, ['UserSession'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { UserSession } = models

    const currentTokenId = user.tokenId || null
    const userObjectId = getUserObjectId(user)

    // Build query to revoke all sessions except current
    const query = {
      user: userObjectId,
      isActive: true,
    }

    // If we have a current token ID, exclude it from revocation
    if (currentTokenId) {
      query.tokenId = { $ne: currentTokenId }
    }

    const result = await UserSession.updateMany(query, {
      isActive: false,
      revokedAt: new Date(),
      revokedReason: 'user_logout',
    })

    console.log(`[sessions] Revoked ${result.modifiedCount} sessions for user ${userObjectId}`)

    return NextResponse.json({
      success: true,
      message: `Logged out from ${result.modifiedCount} other device(s)`,
      revokedCount: result.modifiedCount,
    })
  } catch (error) {
    console.error('[sessions] Error revoking sessions:', error)
    return NextResponse.json(
      { error: 'Failed to revoke sessions' },
      { status: 500 }
    )
  }
}
