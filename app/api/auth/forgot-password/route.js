import { NextResponse } from 'next/server'
import { sendPasswordResetEmail } from '@/lib/mailer'
import { getTenantByEmail } from '@/lib/tenantContext'
import { getNativeAuthRepository } from '@/lib/platform/firestoreAuth.server'
import { getNativePasswordRepository } from '@/lib/platform/firestorePassword.server'

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const MAX_REQUESTS_PER_WINDOW = 3

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { email } = body
    console.log('[forgot-password] Received request for email:', email)

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.toLowerCase().trim()
    console.log('[forgot-password] Normalized email:', normalizedEmail)

    // Look up tenant for this email
    const tenantInfo = await getTenantByEmail(normalizedEmail)
    if (!tenantInfo) {
      console.log(`[forgot-password] No tenant mapping found for: ${normalizedEmail}`)
      return NextResponse.json(
        { success: false, error: 'No account found with this email address. Please check and try again.' },
        { status: 404 }
      )
    }

    console.log(`[forgot-password] User belongs to tenant: ${tenantInfo.companySlug} (${tenantInfo.databaseName})`)

    // Get tenant-specific models
    const repository = await getNativeAuthRepository(tenantInfo.databaseName)
    const passwords = await getNativePasswordRepository(tenantInfo.databaseName)

    // Get request info for security logging
    const forwarded = request.headers.get('x-forwarded-for')
    const ipAddress = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || 'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'

    // Find user by email
    const user = await repository.findUser(normalizedEmail)
    console.log('[forgot-password] User found:', user ? 'Yes' : 'No', user ? `(${user._id})` : '')

    if (!user) {
      console.log(`[forgot-password] No user found for email: ${normalizedEmail}`)
      return NextResponse.json(
        { success: false, error: 'No account found with this email address. Please check and try again.' },
        { status: 404 }
      )
    }

    if (!user.isActive) {
      console.log(`[forgot-password] User account is deactivated: ${normalizedEmail}`)
      return NextResponse.json(
        { success: false, error: 'This account has been deactivated. Please contact your administrator.' },
        { status: 403 }
      )
    }

    // Success response for when email is sent
    const successResponse = NextResponse.json({
      success: true,
      message: 'Password reset link has been sent to your email address.',
    })

    const issued = await passwords.issue(user._id, { ipAddress, userAgent, windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: MAX_REQUESTS_PER_WINDOW })
    if (!issued) {
      console.log(`[forgot-password] Rate limit exceeded for user: ${user._id}`)
      // Still return success to prevent enumeration, but don't send email
      return successResponse
    }

    const { token } = issued

    // Build reset link with tenant info
    const baseUrl = process.env.NEXTAUTH_URL || 'https://app.talio.in'
    // Include tenant slug in the reset link for multi-tenant support
    const resetLink = `${baseUrl}/auth/reset-password/${token}?tenant=${encodeURIComponent(tenantInfo.companySlug)}`

    // Get first name from user or employee
    let firstName = 'there'
    if (user.name) {
      firstName = user.name.split(' ')[0]
    } else if (user.employeeId) {
      try {
        const employee = await repository.database.get('employees', String(user.employeeId))
        if (employee?.firstName) {
          firstName = employee.firstName
        }
      } catch (e) {
        console.log('[forgot-password] Could not fetch employee name:', e.message)
      }
    }
    console.log('[forgot-password] Sending email to:', user.email, 'firstName:', firstName)

    // Send email
    const emailResult = await sendPasswordResetEmail({
      to: user.email,
      firstName,
      resetLink,
      expiresInMinutes: 15,
    })
    console.log('[forgot-password] Email result:', emailResult)

    if (!emailResult.success) {
      console.error(`[forgot-password] Failed to send email:`, {
        error: emailResult.error,
        userEmail: user.email,
        timestamp: new Date().toISOString(),
      })
      return NextResponse.json(
        { 
          success: false, 
          error: 'Failed to send reset email. Please try again later or contact support.',
          errorCode: 'EMAIL_SEND_FAILED'
        },
        { status: 500 }
      )
    }
    
    console.log(`[forgot-password] Reset email sent successfully to ${user.email}`)
    return successResponse
  } catch (error) {
    // Enhanced error logging with context
    const errorContext = {
      timestamp: new Date().toISOString(),
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
    }
    console.error('[forgot-password] Error:', JSON.stringify(errorContext, null, 2))

    // Differentiate error types for internal tracking
    let errorCode = 'FORGOT_PASSWORD_ERROR'

    if ([4, 14].includes(error.code) || error.message?.includes('ETIMEOUT')) {
      errorCode = 'DB_CONNECTION_ERROR'
    } else if (error.message?.includes('ECONNREFUSED') || error.message?.includes('SMTP')) {
      errorCode = 'EMAIL_SERVICE_ERROR'
    }

    return NextResponse.json(
      { error: 'Something went wrong. Please try again later.' },
      { status: 500 }
    )
  }
}
