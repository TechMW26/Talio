import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { jwtVerify } from 'jose'
import { sendPasswordResetEmail } from '@/lib/mailer'
import crypto from 'crypto'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key')

// Helper functions for token generation (same as in model)
function generateToken() {
  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  return { token, tokenHash }
}

/**
 * POST - Admin/HR send password reset link to user
 * This does NOT change the user's password - they can still login with their current password
 * until they click the reset link and set a new password
 */
export async function POST(request, { params }) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.get('Authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const token = authHeader.split(' ')[1]

    // Verify the token
    let payload
    try {
      const verified = await jwtVerify(token, JWT_SECRET)
      payload = verified.payload
    } catch (error) {
      return NextResponse.json(
        { success: false, message: 'Invalid token' },
        { status: 401 }
      )
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'PasswordResetToken'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Employee, PasswordResetToken } = models

    // Verify requesting user is admin or HR
    const requestingUser = await User.findById(payload.userId).select('role')
    
    if (!requestingUser || !['admin', 'hr'].includes(requestingUser.role)) {
      return NextResponse.json(
        { success: false, message: 'Only Admin or HR can send password reset links' },
        { status: 403 }
      )
    }

    const { userId } = await params

    // Find the target user
    const targetUser = await User.findById(userId).select('email role isActive employeeId')

    if (!targetUser) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      )
    }

    if (!targetUser.isActive) {
      return NextResponse.json(
        { success: false, message: 'Cannot send reset link to deactivated user' },
        { status: 400 }
      )
    }

    // Get request info for security logging
    const forwarded = request.headers.get('x-forwarded-for')
    const ipAddress = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || 'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'

    // Invalidate any existing unused tokens
    await PasswordResetToken.updateMany(
      { user: targetUser._id, usedAt: null },
      { usedAt: new Date() }
    )

    // Generate new token
    const { token: resetToken, tokenHash } = generateToken()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours for admin-initiated

    // Save token to database
    await PasswordResetToken.create({
      user: targetUser._id,
      token: tokenHash,
      tokenHash,
      expiresAt,
      requestedFromIp: ipAddress,
      requestedUserAgent: userAgent,
    })

    // Build reset link
    const baseUrl = process.env.NEXTAUTH_URL || 'https://app.talio.in'
    const resetLink = `${baseUrl}/auth/reset-password/${resetToken}`

    // Get first name from employee
    let firstName = 'there'
    if (targetUser.employeeId) {
      try {
        const employee = await Employee.findById(targetUser.employeeId).select('firstName').lean()
        if (employee?.firstName) {
          firstName = employee.firstName
        }
      } catch (e) {
        console.log('[send-reset-link] Could not fetch employee name:', e.message)
      }
    }

    // Send email
    const emailResult = await sendPasswordResetEmail({
      to: targetUser.email,
      firstName,
      resetLink,
    })

    if (!emailResult.success) {
      console.error('[send-reset-link] Failed to send email:', emailResult.error)
      return NextResponse.json(
        { success: false, message: 'Failed to send reset email. Please try again.' },
        { status: 500 }
      )
    }

    // Get employee name for response
    let employeeName = targetUser.email
    if (targetUser.employeeId) {
      const employee = await Employee.findById(targetUser.employeeId).select('firstName lastName')
      if (employee) {
        employeeName = `${employee.firstName} ${employee.lastName}`
      }
    }

    console.log(`[send-reset-link] Reset link sent to ${targetUser.email} by admin ${payload.userId}`)

    return NextResponse.json({
      success: true,
      message: `Password reset link sent to ${employeeName} (${targetUser.email}). The link will expire in 24 hours.`,
      data: {
        email: targetUser.email,
        expiresAt,
      }
    })

  } catch (error) {
    console.error('[Send Reset Link] Error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to send reset link' },
      { status: 500 }
    )
  }
}
