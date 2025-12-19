import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import OnboardingEmail from '@/models/OnboardingEmail'
import { verifyToken } from '@/lib/auth'
import { retryOnboardingEmail } from '@/lib/mailer'

/**
 * POST - Retry sending a single onboarding email
 */
export async function POST(request, { params }) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }
    
    const token = authHeader.split(' ')[1]
    const payload = await verifyToken(token)
    
    if (!payload) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }
    
    // Only admin and HR can retry emails
    if (!['admin', 'hr', 'god_admin'].includes(payload.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }
    
    await connectDB()
    
    const { id } = await params
    
    if (!id) {
      return NextResponse.json({ success: false, message: 'Email ID is required' }, { status: 400 })
    }
    
    // Check if email exists
    const emailLog = await OnboardingEmail.findById(id)
    
    if (!emailLog) {
      return NextResponse.json({ success: false, message: 'Email not found' }, { status: 404 })
    }
    
    // Retry sending the email
    const result = await retryOnboardingEmail(id, payload.userId)
    
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
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }
    
    const token = authHeader.split(' ')[1]
    const payload = await verifyToken(token)
    
    if (!payload) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }
    
    if (!['admin', 'hr', 'god_admin'].includes(payload.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }
    
    await connectDB()
    
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
