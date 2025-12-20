import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import User from '@/models/User'
import Employee from '@/models/Employee'
import PasswordResetToken from '@/models/PasswordResetToken'
import UserSession from '@/models/UserSession'
import { sendPasswordChangedEmail } from '@/lib/mailer'
import { syncUserToBackup } from '@/lib/backupDb'
import bcrypt from 'bcryptjs'

// GET - Validate token before showing reset form
export async function GET(request, { params }) {
  try {
    await connectDB()

    const { token } = await params

    if (!token) {
      return NextResponse.json(
        { valid: false, error: 'Token is required' },
        { status: 400 }
      )
    }

    // Hash the token to look it up
    const tokenHash = PasswordResetToken.hashToken(token)

    const resetToken = await PasswordResetToken.findOne({
      tokenHash,
    }).populate('user', 'email name')

    if (!resetToken) {
      return NextResponse.json(
        { valid: false, error: 'Invalid or expired reset link' },
        { status: 400 }
      )
    }

    if (!resetToken.isValid()) {
      return NextResponse.json(
        { valid: false, error: 'This reset link has expired or already been used' },
        { status: 400 }
      )
    }

    if (!resetToken.user) {
      return NextResponse.json(
        { valid: false, error: 'User account not found' },
        { status: 400 }
      )
    }

    // Return masked email for display
    const email = resetToken.user.email
    const maskedEmail = email.replace(/(.{2})(.*)(@.*)/, '$1***$3')

    return NextResponse.json({
      valid: true,
      email: maskedEmail,
      expiresAt: resetToken.expiresAt,
    })
  } catch (error) {
    console.error('[reset-password] Validation error:', error)
    return NextResponse.json(
      { valid: false, error: 'Something went wrong' },
      { status: 500 }
    )
  }
}

// POST - Reset the password
export async function POST(request, { params }) {
  try {
    await connectDB()

    const { token } = await params
    const { password } = await request.json()

    // Get request info for logging
    const forwarded = request.headers.get('x-forwarded-for')
    const ipAddress = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || 'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Token is required' },
        { status: 400 }
      )
    }

    if (!password) {
      return NextResponse.json(
        { success: false, error: 'Password is required' },
        { status: 400 }
      )
    }

    // Validate password strength
    const passwordErrors = validatePassword(password)
    if (passwordErrors.length > 0) {
      return NextResponse.json(
        { success: false, error: passwordErrors.join('. ') },
        { status: 400 }
      )
    }

    // Hash the token to look it up
    const tokenHash = PasswordResetToken.hashToken(token)

    const resetToken = await PasswordResetToken.findOne({
      tokenHash,
    }).populate('user')

    if (!resetToken) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired reset link' },
        { status: 400 }
      )
    }

    if (!resetToken.isValid()) {
      return NextResponse.json(
        { success: false, error: 'This reset link has expired or already been used' },
        { status: 400 }
      )
    }

    if (!resetToken.user) {
      return NextResponse.json(
        { success: false, error: 'User account not found' },
        { status: 400 }
      )
    }

    // Fetch user with password field for comparison (password has select: false)
    const user = await User.findById(resetToken.user._id).select('+password')

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User account not found' },
        { status: 400 }
      )
    }

    if (!user.isActive) {
      return NextResponse.json(
        { success: false, error: 'User account is deactivated' },
        { status: 400 }
      )
    }

    // Check if new password is same as old password
    const isSamePassword = await bcrypt.compare(password, user.password)
    if (isSamePassword) {
      return NextResponse.json(
        { success: false, error: 'New password must be different from your current password' },
        { status: 400 }
      )
    }

    // Update user password (will be hashed by pre-save hook)
    user.password = password
    user.forcePasswordChange = false
    user.passwordChangedAt = new Date()
    
    // Clear any legacy password reset fields
    user.passwordResetToken = undefined
    user.passwordResetExpires = undefined
    
    await user.save()

    // Sync updated password to backup database (fire-and-forget)
    const userWithNewPassword = await User.findById(user._id).select('+password').lean()
    const employee = await Employee.findById(user.employeeId).select('firstName lastName').lean()
    syncUserToBackup({
      userId: user._id,
      email: user.email,
      firstName: employee?.firstName || '',
      lastName: employee?.lastName || '',
      password: userWithNewPassword.password,
      role: user.role,
    }).catch(err => console.error('[Reset Password] Backup sync failed:', err))

    // Mark token as used
    resetToken.usedAt = new Date()
    resetToken.usedFromIp = ipAddress
    resetToken.usedUserAgent = userAgent
    await resetToken.save()

    // Invalidate all user sessions (security: password change should logout everywhere)
    const revokedCount = await UserSession.updateMany(
      { user: user._id, isActive: true },
      { 
        isActive: false, 
        revokedAt: new Date(), 
        revokedReason: 'password_change' 
      }
    )

    console.log(`[reset-password] Password reset for user ${user._id}, revoked ${revokedCount.modifiedCount} sessions`)

    // Get first name for email
    const firstName = user.name?.split(' ')[0] || 'there'

    // Send confirmation email
    await sendPasswordChangedEmail({
      to: user.email,
      firstName,
      changedAt: new Date(),
      ipAddress,
      userAgent,
    })

    return NextResponse.json({
      success: true,
      message: 'Password has been reset successfully. Please log in with your new password.',
    })
  } catch (error) {
    console.error('[reset-password] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}

// Password validation helper
function validatePassword(password) {
  const errors = []

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long')
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter')
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter')
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number')
  }

  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character')
  }

  return errors
}
