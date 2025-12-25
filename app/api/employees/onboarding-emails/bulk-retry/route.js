import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import { retryOnboardingEmail } from '@/lib/mailer'

/**
 * POST - Bulk retry sending multiple onboarding emails
 */
export async function POST(request) {
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
    if (!['admin', 'hr'].includes(payload.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }
    
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['OnboardingEmail'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { OnboardingEmail } = models

    const { emailIds } = await request.json()
    
    if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
      return NextResponse.json({ success: false, message: 'Email IDs are required' }, { status: 400 })
    }
    
    // Limit bulk retry to 50 emails at a time
    if (emailIds.length > 50) {
      return NextResponse.json({ 
        success: false, 
        message: 'Maximum 50 emails can be retried at once' 
      }, { status: 400 })
    }
    
    const results = {
      successful: [],
      failed: [],
    }
    
    // Process emails sequentially to avoid overwhelming the email server
    for (const emailId of emailIds) {
      try {
        const result = await retryOnboardingEmail(emailId, payload.userId)
        
        if (result.success) {
          results.successful.push(emailId)
        } else {
          results.failed.push({ id: emailId, error: result.error })
        }
      } catch (error) {
        results.failed.push({ id: emailId, error: error.message })
      }
      
      // Small delay between emails to prevent rate limiting
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    return NextResponse.json({
      success: true,
      message: `Processed ${emailIds.length} emails: ${results.successful.length} sent, ${results.failed.length} failed`,
      results,
    })
  } catch (error) {
    console.error('Bulk retry onboarding emails error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to retry emails' },
      { status: 500 }
    )
  }
}
