import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import UserSession from '@/models/UserSession'
import { verifyToken } from '@/lib/auth'

// GET - List all active sessions for current user
export async function GET(request) {
  try {
    await connectDB()

    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Get current session's token ID if available
    const currentTokenId = payload.tokenId || null

    // Fetch all active sessions for this user
    const sessions = await UserSession.find({
      user: payload.userId,
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
    await connectDB()

    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const currentTokenId = payload.tokenId || null

    // Build query to revoke all sessions except current
    const query = {
      user: payload.userId,
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

    console.log(`[sessions] Revoked ${result.modifiedCount} sessions for user ${payload.userId}`)

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
