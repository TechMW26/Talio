import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { getTenantModel } from '@/lib/tenantModels'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key')

export async function GET(request) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.get('Authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { valid: false, message: 'No token provided' },
        { status: 401 }
      )
    }

    const token = authHeader.split(' ')[1]

    // Verify the token
    const { payload } = await jwtVerify(token, JWT_SECRET)

    if (!payload || !payload.userId) {
      return NextResponse.json(
        { valid: false, message: 'Invalid token payload' },
        { status: 401 }
      )
    }

    // SECURITY: Require tenant context from JWT
    if (!payload.databaseName) {
      return NextResponse.json(
        { valid: false, message: 'Invalid session - please log in again' },
        { status: 401 }
      )
    }

    // Get tenant-specific User model
    const User = await getTenantModel(payload.databaseName, 'User')

    // Check if user still exists and is active
    const user = await User.findById(payload.userId).select('isActive email forcePasswordChange')

    if (!user) {
      return NextResponse.json(
        { valid: false, message: 'User not found' },
        { status: 401 }
      )
    }

    if (!user.isActive) {
      return NextResponse.json(
        { valid: false, message: 'Account deactivated' },
        { status: 401 }
      )
    }

    // Create response
    const response = NextResponse.json({
      valid: true,
      userId: payload.userId,
      forcePasswordChange: user.forcePasswordChange === true
    })

    // Ensure cookie is set from server side (fixes loop when client cookie not set properly)
    // Check if cookie exists in request
    const existingCookie = request.cookies.get('token')?.value
    if (!existingCookie && token) {
      response.cookies.set('token', token, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 // 7 days
      })
    }

    return response

  } catch (error) {
    console.error('[Auth Validate] Error:', error.message)

    // Token expired or invalid
    if (error.code === 'ERR_JWT_EXPIRED') {
      return NextResponse.json(
        { valid: false, message: 'Token expired' },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { valid: false, message: 'Invalid token' },
      { status: 401 }
    )
  }
}
