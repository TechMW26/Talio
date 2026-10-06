import { NextResponse } from 'next/server'
import { sendPasswordChangedEmail } from '@/lib/mailer'
import { getTenantBySlug } from '@/lib/tenantContext'
import { getNativePasswordRepository } from '@/lib/platform/firestorePassword.server'

// GET - Validate token before showing reset form
export async function GET(request, { params }) {
  try {
    const { token } = await params
    const { searchParams } = new URL(request.url)
    const tenantSlug = searchParams.get('tenant')

    if (!token || token === 'undefined' || token === 'null') {
      return NextResponse.json(
        { valid: false, error: 'Token is required' },
        { status: 400 }
      )
    }

    if (!tenantSlug) {
      return NextResponse.json(
        { valid: false, error: 'Invalid reset link' },
        { status: 400 }
      )
    }

    // Get tenant info
    const tenantInfo = await getTenantBySlug(tenantSlug)
    if (!tenantInfo) {
      return NextResponse.json(
        { valid: false, error: 'Invalid reset link' },
        { status: 400 }
      )
    }

    const passwords = await getNativePasswordRepository(tenantInfo.databaseName)
    const { token: resetToken, user } = await passwords.validate(token)

    // Return masked email for display
    const email = user.email
    const maskedEmail = email.replace(/(.{2})(.*)(@.*)/, '$1***$3')

    return NextResponse.json({
      valid: true,
      email: maskedEmail,
      expiresAt: resetToken.expiresAt,
    })
  } catch (error) {
    if (error.code === 'INVALID_RESET') return NextResponse.json({ valid: false, error: error.message }, { status: 400 })
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
    const { token } = await params
    const body = await request.json().catch(() => ({}))
    const { password, tenant: tenantSlug } = body

    // Get request info for logging
    const forwarded = request.headers.get('x-forwarded-for')
    const ipAddress = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || 'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'

    if (!token || token === 'undefined' || token === 'null') {
      return NextResponse.json(
        { success: false, error: 'Token is required' },
        { status: 400 }
      )
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Password is required' },
        { status: 400 }
      )
    }

    if (!tenantSlug || typeof tenantSlug !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Invalid reset request' },
        { status: 400 }
      )
    }

    // Get tenant info
    const tenantInfo = await getTenantBySlug(tenantSlug)
    if (!tenantInfo) {
      return NextResponse.json(
        { success: false, error: 'Invalid reset request' },
        { status: 400 }
      )
    }

    const passwords = await getNativePasswordRepository(tenantInfo.databaseName)

    // Validate password strength
    const passwordErrors = validatePassword(password)
    if (passwordErrors.length > 0) {
      return NextResponse.json(
        { success: false, error: passwordErrors.join('. ') },
        { status: 400 }
      )
    }

    const user = await passwords.reset(token, password, { ipAddress, userAgent })

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
    if (error.code === 'INVALID_RESET') return NextResponse.json({ success: false, error: error.message }, { status: 400 })
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
