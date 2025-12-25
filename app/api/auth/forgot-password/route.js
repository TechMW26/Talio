import { NextResponse } from 'next/server'
import { sendPasswordResetEmail } from '@/lib/mailer'
import { getTenantByEmail } from '@/lib/tenantContext'
import { getTenantModels } from '@/lib/tenantModels'

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const MAX_REQUESTS_PER_WINDOW = 3

export async function POST(request) {
  try {
    const { email } = await request.json()
    console.log('[forgot-password] Received request for email:', email)

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
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
    const tenantModels = await getTenantModels(tenantInfo.databaseName, ['User', 'Employee', 'PasswordResetToken'])
    const TenantUser = tenantModels.User
    const TenantEmployee = tenantModels.Employee
    const TenantPasswordResetToken = tenantModels.PasswordResetToken

    // Get request info for security logging
    const forwarded = request.headers.get('x-forwarded-for')
    const ipAddress = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || 'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'

    // Find user by email
    const user = await TenantUser.findOne({ email: normalizedEmail })
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

    // Check rate limiting - count recent reset requests for this user
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS)
    const recentRequests = await TenantPasswordResetToken.countDocuments({
      user: user._id,
      createdAt: { $gte: windowStart },
    })

    if (recentRequests >= MAX_REQUESTS_PER_WINDOW) {
      console.log(`[forgot-password] Rate limit exceeded for user: ${user._id}`)
      // Still return success to prevent enumeration, but don't send email
      return successResponse
    }

    // Invalidate any existing unused tokens
    await TenantPasswordResetToken.updateMany(
      { user: user._id, usedAt: null },
      { usedAt: new Date() }
    )

    // Generate new token
    const { token, tokenHash } = TenantPasswordResetToken.generateToken()
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
    console.log('[forgot-password] Generated token, expires at:', expiresAt)

    // Save token to database
    await TenantPasswordResetToken.create({
      user: user._id,
      token: tokenHash, // Store hashed version
      tokenHash,
      expiresAt,
      requestedFromIp: ipAddress,
      requestedUserAgent: userAgent,
    })
    console.log('[forgot-password] Token saved to database')

    // Build reset link with tenant info
    const baseUrl = process.env.NEXTAUTH_URL || 'https://app.talio.in'
    // Include tenant slug in the reset link for multi-tenant support
    const resetLink = `${baseUrl}/auth/reset-password/${token}?tenant=${encodeURIComponent(tenantInfo.companySlug)}`
    console.log('[forgot-password] Reset link generated:', resetLink)

    // Get first name from user or employee
    let firstName = 'there'
    if (user.name) {
      firstName = user.name.split(' ')[0]
    } else if (user.employeeId) {
      try {
        const employee = await TenantEmployee.findById(user.employeeId).select('firstName').lean()
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
      console.error(`[forgot-password] Failed to send email: ${emailResult.error}`)
      return NextResponse.json(
        { success: false, error: 'Failed to send reset email. Please try again later or contact support.' },
        { status: 500 }
      )
    }
    
    console.log(`[forgot-password] Reset email sent successfully to ${user.email}`)
    return successResponse
  } catch (error) {
    console.error('[forgot-password] Error:', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again later.' },
      { status: 500 }
    )
  }
}
