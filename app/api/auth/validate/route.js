import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import connectDB from '@/lib/mongodb'
import User from '@/models/User'

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

    // Check if user still exists and is active
    await connectDB()
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

    return NextResponse.json({
      valid: true,
      userId: payload.userId,
      forcePasswordChange: user.forcePasswordChange === true
    })

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
