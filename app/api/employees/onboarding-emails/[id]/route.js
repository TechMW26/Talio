import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { retryOnboardingEmail } from '@/lib/mailer'

/**
 * POST - Retry sending a single onboarding email
 */
export async function POST(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['OnboardingEmail'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { OnboardingEmail } = models
    
    // Only admin and HR can retry emails
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    const { id } = await params
    
    if (!id) {
      return NextResponse.json({ success: false, message: 'Email ID is required' }, { status: 400 })
    }
    
    // Check if email exists
    const emailLog = await OnboardingEmail.findById(id)
    
    if (!emailLog) {
      return NextResponse.json({ success: false, message: 'Email not found' }, { status: 404 })
    }
    
    // Retry sending the email - pass tenant models for multi-tenant support
    const result = await retryOnboardingEmail(id, user._id || user.userId, models)
    
    // Get updated email log
    const updatedEmail = await OnboardingEmail.findById(id)
      .populate('employee', 'firstName lastName employeeCode profilePicture')
      .populate('retriedBy', 'email')
      .lean()
    
    return NextResponse.json({
      success: result.success,
      message: result.success ? 'Email sent successfully' : `Failed to send email: ${result.error}`,
      data: updatedEmail,
    })
  } catch (error) {
    console.error('Retry onboarding email error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to retry email' },
      { status: 500 }
    )
  }
}

/**
 * GET - Get single onboarding email details
 */
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['OnboardingEmail'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { OnboardingEmail } = models
    
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }
    
    const { id } = await params
    
    const email = await OnboardingEmail.findById(id)
      .populate('employee', 'firstName lastName employeeCode profilePicture email')
      .populate('user', 'email role')
      .populate('retriedBy', 'email')
      .lean()
    
    if (!email) {
      return NextResponse.json({ success: false, message: 'Email not found' }, { status: 404 })
    }
    
    return NextResponse.json({
      success: true,
      data: email,
    })
  } catch (error) {
    console.error('Get onboarding email error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to fetch email' },
      { status: 500 }
    )
  }
}
