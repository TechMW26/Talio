import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import OnboardingEmail from '@/models/OnboardingEmail'
import { sendOnboardingEmail } from '@/lib/mailer'
import { getTenantConnection } from '@/lib/tenantModels'
import CompanyMapping from '@/models/CompanyMapping'

// Rate limiting configuration
const EMAIL_RATE_LIMIT = {
  maxPerMinute: 10,        // Max emails per minute
  cooldownMinutes: 5,      // Cooldown period after rate limit
  maxAutoRetries: 5,       // Maximum automatic retries
  backoffMultiplier: 2,    // Exponential backoff multiplier
}

/**
 * Calculate next retry time with exponential backoff
 */
function calculateNextRetryTime(retryCount) {
  const baseDelayMinutes = EMAIL_RATE_LIMIT.cooldownMinutes
  const backoffMinutes = baseDelayMinutes * Math.pow(EMAIL_RATE_LIMIT.backoffMultiplier, retryCount)
  const maxDelayMinutes = 60 // Max 1 hour delay
  const delayMinutes = Math.min(backoffMinutes, maxDelayMinutes)
  
  return new Date(Date.now() + delayMinutes * 60 * 1000)
}

/**
 * Check if an error message indicates rate limiting
 */
function isRateLimitError(errorMessage) {
  if (!errorMessage) return false
  const rateLimitPatterns = [
    'rate',
    'limit',
    '451',
    '452',
    '421',
    'too many',
    'throttl',
    'slow down',
    'try again later',
    'temporarily',
    'deferred',
  ]
  const lowerError = errorMessage.toLowerCase()
  return rateLimitPatterns.some(pattern => lowerError.includes(pattern))
}

/**
 * Process a single email from the queue
 */
async function processQueuedEmail(emailLog) {
  emailLog.queued = false
  emailLog.scheduledFor = null
  
  try {
    const result = await sendOnboardingEmail({
      to: emailLog.recipientEmail,
      firstName: emailLog.recipientName.split(' ')[0],
      lastName: emailLog.recipientName.split(' ').slice(1).join(' '),
      email: emailLog.recipientEmail,
      password: emailLog.passwordSent,
      employeeCode: emailLog.employeeCode,
      designation: emailLog.designation,
      department: emailLog.department,
      dateOfJoining: emailLog.dateOfJoining,
    })
    
    if (result.success) {
      emailLog.status = 'sent'
      emailLog.sentAt = new Date()
      emailLog.errorMessage = null
      emailLog.rateLimitedUntil = null
      await emailLog.save()
      return { success: true, emailId: emailLog._id }
    } else {
      // Check if rate limited
      if (isRateLimitError(result.error)) {
        emailLog.autoRetryCount += 1
        
        if (emailLog.autoRetryCount < EMAIL_RATE_LIMIT.maxAutoRetries) {
          // Schedule for retry
          emailLog.status = 'pending'
          emailLog.queued = true
          emailLog.scheduledFor = calculateNextRetryTime(emailLog.autoRetryCount)
          emailLog.rateLimitedUntil = emailLog.scheduledFor
          emailLog.errorMessage = `Rate limited. Auto-retry ${emailLog.autoRetryCount}/${EMAIL_RATE_LIMIT.maxAutoRetries} scheduled for ${emailLog.scheduledFor.toISOString()}`
          await emailLog.save()
          
          return { 
            success: false, 
            emailId: emailLog._id,
            rateLimited: true,
            scheduledFor: emailLog.scheduledFor,
            error: emailLog.errorMessage
          }
        } else {
          // Max retries exceeded
          emailLog.status = 'failed'
          emailLog.errorMessage = `Rate limited. Maximum auto-retries (${EMAIL_RATE_LIMIT.maxAutoRetries}) exceeded. Original error: ${result.error}`
          await emailLog.save()
          return { success: false, emailId: emailLog._id, error: emailLog.errorMessage }
        }
      } else {
        // Non-rate-limit error
        emailLog.status = 'failed'
        emailLog.errorMessage = result.error || 'Unknown error'
        await emailLog.save()
        return { success: false, emailId: emailLog._id, error: emailLog.errorMessage }
      }
    }
  } catch (error) {
    // Check if rate limited
    if (isRateLimitError(error.message)) {
      emailLog.autoRetryCount += 1
      
      if (emailLog.autoRetryCount < EMAIL_RATE_LIMIT.maxAutoRetries) {
        emailLog.status = 'pending'
        emailLog.queued = true
        emailLog.scheduledFor = calculateNextRetryTime(emailLog.autoRetryCount)
        emailLog.rateLimitedUntil = emailLog.scheduledFor
        emailLog.errorMessage = `Rate limited. Auto-retry ${emailLog.autoRetryCount}/${EMAIL_RATE_LIMIT.maxAutoRetries} scheduled.`
        await emailLog.save()
        
        return { 
          success: false, 
          emailId: emailLog._id,
          rateLimited: true,
          scheduledFor: emailLog.scheduledFor
        }
      }
    }
    
    emailLog.status = 'failed'
    emailLog.errorMessage = error.message || 'Unknown error'
    await emailLog.save()
    return { success: false, emailId: emailLog._id, error: emailLog.errorMessage }
  }
}

/**
 * GET - Process email queue (called by cron job)
 * 
 * This should be called every minute by a cron job.
 * It processes emails that are queued and scheduled for now or earlier.
 */
export async function GET(request) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      // Allow localhost/internal calls without secret for dev
      const host = request.headers.get('host') || ''
      if (!host.includes('localhost') && !host.includes('127.0.0.1')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    await connectDB()
    
    const now = new Date()
    const results = {
      processed: 0,
      sent: 0,
      rescheduled: 0,
      failed: 0,
      errors: [],
      tenants: {},
    }

    // Get all company mappings to process tenant databases
    const mappings = await CompanyMapping.find({ isActive: true }).lean()
    
    for (const mapping of mappings) {
      try {
        const tenantDb = await getTenantConnection(mapping.databaseName)
        const TenantOnboardingEmail = tenantDb.model('OnboardingEmail')
        
        // Find emails ready to process
        const queuedEmails = await TenantOnboardingEmail.find({
          queued: true,
          scheduledFor: { $lte: now },
        }).limit(EMAIL_RATE_LIMIT.maxPerMinute).sort({ scheduledFor: 1 })

        if (queuedEmails.length === 0) continue

        results.tenants[mapping.companyCode] = {
          found: queuedEmails.length,
          sent: 0,
          rescheduled: 0,
          failed: 0,
        }

        for (const emailLog of queuedEmails) {
          results.processed++
          
          const processResult = await processQueuedEmail(emailLog)
          
          if (processResult.success) {
            results.sent++
            results.tenants[mapping.companyCode].sent++
          } else if (processResult.rateLimited) {
            results.rescheduled++
            results.tenants[mapping.companyCode].rescheduled++
          } else {
            results.failed++
            results.tenants[mapping.companyCode].failed++
            results.errors.push({
              emailId: processResult.emailId,
              error: processResult.error,
            })
          }

          // Delay between emails to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 3000))
        }
      } catch (tenantError) {
        console.error(`[email-queue] Error processing tenant ${mapping.companyCode}:`, tenantError)
        results.errors.push({
          tenant: mapping.companyCode,
          error: tenantError.message,
        })
      }
    }

    // Also process global/fallback database emails
    try {
      const globalQueuedEmails = await OnboardingEmail.find({
        queued: true,
        scheduledFor: { $lte: now },
      }).limit(EMAIL_RATE_LIMIT.maxPerMinute).sort({ scheduledFor: 1 })

      for (const emailLog of globalQueuedEmails) {
        results.processed++
        
        const processResult = await processQueuedEmail(emailLog)
        
        if (processResult.success) {
          results.sent++
        } else if (processResult.rateLimited) {
          results.rescheduled++
        } else {
          results.failed++
        }

        await new Promise(resolve => setTimeout(resolve, 3000))
      }
    } catch (globalError) {
      console.error('[email-queue] Error processing global emails:', globalError)
    }

    console.log(`[email-queue] Processed: ${results.processed}, Sent: ${results.sent}, Rescheduled: ${results.rescheduled}, Failed: ${results.failed}`)

    return NextResponse.json({
      success: true,
      message: `Processed ${results.processed} emails: ${results.sent} sent, ${results.rescheduled} rescheduled, ${results.failed} failed`,
      results,
      timestamp: now.toISOString(),
    })
  } catch (error) {
    console.error('[email-queue] Cron job error:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

/**
 * POST - Manually queue failed emails for retry
 */
export async function POST(request) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      const host = request.headers.get('host') || ''
      if (!host.includes('localhost') && !host.includes('127.0.0.1')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    await connectDB()
    
    const { action, delayMinutes = 5 } = await request.json()
    
    if (action === 'queue-all-failed') {
      // Queue all failed emails for retry
      const scheduledFor = new Date(Date.now() + delayMinutes * 60 * 1000)
      
      // Process all tenant databases
      const mappings = await CompanyMapping.find({ isActive: true }).lean()
      let totalQueued = 0

      for (const mapping of mappings) {
        try {
          const tenantDb = await getTenantConnection(mapping.databaseName)
          const TenantOnboardingEmail = tenantDb.model('OnboardingEmail')
          
          const result = await TenantOnboardingEmail.updateMany(
            { 
              status: 'failed',
              queued: { $ne: true },
              autoRetryCount: { $lt: EMAIL_RATE_LIMIT.maxAutoRetries }
            },
            {
              $set: {
                queued: true,
                scheduledFor: scheduledFor,
                status: 'pending',
              }
            }
          )
          
          totalQueued += result.modifiedCount
        } catch (err) {
          console.error(`[email-queue] Error queueing failed emails for ${mapping.companyCode}:`, err)
        }
      }

      // Also process global database
      const globalResult = await OnboardingEmail.updateMany(
        { 
          status: 'failed',
          queued: { $ne: true },
          autoRetryCount: { $lt: EMAIL_RATE_LIMIT.maxAutoRetries }
        },
        {
          $set: {
            queued: true,
            scheduledFor: scheduledFor,
            status: 'pending',
          }
        }
      )
      
      totalQueued += globalResult.modifiedCount

      return NextResponse.json({
        success: true,
        message: `Queued ${totalQueued} failed emails for retry at ${scheduledFor.toISOString()}`,
        scheduledFor: scheduledFor.toISOString(),
        queuedCount: totalQueued,
      })
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('[email-queue] POST error:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
