import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { retryOnboardingEmail } from '@/lib/mailer'

/**
 * POST - Bulk retry sending multiple onboarding emails
 */
export async function POST(request) {
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
        // Pass tenant models for multi-tenant support
        const result = await retryOnboardingEmail(emailId, user._id || user.userId, models)
        
        if (result.success) {
          results.successful.push(emailId)
        } else {
          // Check if rate limited - schedule for later
          if (result.rateLimited) {
            results.failed.push({ id: emailId, error: result.error, rateLimited: true, scheduledFor: result.scheduledFor })
          } else {
            results.failed.push({ id: emailId, error: result.error })
          }
        }
      } catch (error) {
        results.failed.push({ id: emailId, error: error.message })
      }
      
      // Increased delay between emails to prevent rate limiting (2 seconds)
      await new Promise(resolve => setTimeout(resolve, 2000))
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
