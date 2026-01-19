import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

// Rate limiting configuration (should match mailer.js)
const EMAIL_RATE_LIMIT = {
  cooldownMinutes: 5,      // Base cooldown period
  maxAutoRetries: 5,       // Maximum automatic retries
}

/**
 * POST - Queue all failed onboarding emails for automatic retry
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
    
    // Only admin and HR can queue emails
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const delayMinutes = body.delayMinutes || EMAIL_RATE_LIMIT.cooldownMinutes
    
    // Calculate scheduled time
    const scheduledFor = new Date(Date.now() + delayMinutes * 60 * 1000)
    
    // Find and update all failed emails that aren't already queued
    // and haven't exceeded max auto-retries
    const result = await OnboardingEmail.updateMany(
      { 
        status: 'failed',
        queued: { $ne: true },
        $or: [
          { autoRetryCount: { $lt: EMAIL_RATE_LIMIT.maxAutoRetries } },
          { autoRetryCount: { $exists: false } }
        ]
      },
      {
        $set: {
          queued: true,
          scheduledFor: scheduledFor,
          status: 'pending',
          errorMessage: `Queued for auto-retry at ${scheduledFor.toISOString()}`,
        },
        $inc: {
          autoRetryCount: 1
        }
      }
    )
    
    if (result.modifiedCount === 0) {
      return NextResponse.json({
        success: true,
        message: 'No eligible failed emails to queue (all may have exceeded retry limit)',
        queuedCount: 0,
      })
    }

    return NextResponse.json({
      success: true,
      message: `Queued ${result.modifiedCount} failed email(s) for retry at ${scheduledFor.toLocaleString('en-IN')}`,
      queuedCount: result.modifiedCount,
      scheduledFor: scheduledFor.toISOString(),
    })
  } catch (error) {
    console.error('Queue failed emails error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to queue emails' },
      { status: 500 }
    )
  }
}

/**
 * GET - Get queue status
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['OnboardingEmail'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { OnboardingEmail } = models
    
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    const now = new Date()
    
    // Get queue statistics
    const [queuedCount, readyCount, pendingCount, failedCount] = await Promise.all([
      OnboardingEmail.countDocuments({ queued: true }),
      OnboardingEmail.countDocuments({ queued: true, scheduledFor: { $lte: now } }),
      OnboardingEmail.countDocuments({ status: 'pending', queued: { $ne: true } }),
      OnboardingEmail.countDocuments({ status: 'failed' }),
    ])
    
    // Get next scheduled email
    const nextScheduled = await OnboardingEmail.findOne({ 
      queued: true, 
      scheduledFor: { $gt: now } 
    }).sort({ scheduledFor: 1 }).select('scheduledFor')

    return NextResponse.json({
      success: true,
      queue: {
        total: queuedCount,
        ready: readyCount,
        pending: pendingCount,
        failed: failedCount,
        nextScheduledAt: nextScheduled?.scheduledFor || null,
      }
    })
  } catch (error) {
    console.error('Get queue status error:', error)
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    )
  }
}
