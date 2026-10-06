import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { verifyTokenFromRequest } from '@/lib/auth'
import { getNativeAuthRepository } from '@/lib/platform/firestoreAuth.server'

// Cache the encoded JWT secret
let _cachedJwtSecret = null
function getJwtSecret() {
  if (!_cachedJwtSecret) {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required')
    _cachedJwtSecret = new TextEncoder().encode(process.env.JWT_SECRET)
  }
  return _cachedJwtSecret
}

/**
 * GET /api/auth/session
 * Returns the current session information based on JWT token
 * This endpoint is called by NextAuth client but we use JWT-based auth instead
 */
export async function GET(request) {
  try {
    // Check for authorization header
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')

    // Also check for token in cookies (NextAuth pattern)
    const cookieToken = request.cookies.get('token')?.value

    const activeToken = token || cookieToken

    if (!activeToken) {
      // No session - return empty session (not an error)
      return NextResponse.json({
        user: null,
        expires: null
      })
    }

    // Verify JWT token
    const auth = await verifyTokenFromRequest(request)
    if (!auth.success) return NextResponse.json({ user: null, expires: null })
    const payload = auth.user

    // Return session in NextAuth format
    return NextResponse.json({
      user: {
        id: payload.userId,
        email: payload.email,
        role: payload.role,
        name: payload.name || payload.email,
      },
      expires: new Date(payload.exp * 1000).toISOString(), // Convert exp to ISO string
    })
  } catch (error) {
    // Invalid/expired token - return empty session (not an error)
    return NextResponse.json({
      user: null,
      expires: null
    })
  }
}

/**
 * POST /api/auth/session
 * Refresh the JWT token - issues a new token with a fresh 7-day expiry.
 * The current token must still be valid (not expired).
 * Mobile apps should call this proactively when the token is nearing expiry.
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')

    if (!token) {
      return NextResponse.json(
        { success: false, message: 'No token provided' },
        { status: 401 }
      )
    }

    // Verify the existing token
    const auth = await verifyTokenFromRequest(request)
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: 'Invalid or expired token' },
        { status: 401 }
      )
    }
    const repository = await getNativeAuthRepository(auth.tenant.databaseName)
    const expiresAt = new Date(Date.now() + 7 * 86400000)
    const account = await repository.refreshSession(auth.user, expiresAt)
    const payload = { ...auth.user, role: account.role, email: account.email }

    // Issue a new token with the same claims but fresh expiry
    const newToken = await new SignJWT({
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      tokenId: payload.tokenId,
      authVersion: Number(account.authVersion) || 0,
      // Preserve multi-tenant info
      ...(payload.databaseName && { databaseName: payload.databaseName }),
      ...(payload.companySlug && { companySlug: payload.companySlug }),
      ...(payload.companyName && { companyName: payload.companyName }),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(getJwtSecret())

    console.log(`[Auth] Token refreshed for user ${payload.userId}`)

    return NextResponse.json({
      success: true,
      data: {
        token: newToken,
        expiresAt: expiresAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('[Auth] Token refresh error:', error)
    return NextResponse.json(
      { success: false, message: error.status === 401 ? error.message : 'Failed to refresh token' },
      { status: error.status || 500 }
    )
  }
}
