import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

/**
 * GET - Fetch onboarding email history with filters
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['OnboardingEmail', 'CompanySettings'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { OnboardingEmail, CompanySettings } = models
    
    // Only admin and HR can access this
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page')) || 1
    const limit = parseInt(searchParams.get('limit')) || 20
    const status = searchParams.get('status') // 'sent', 'failed', 'pending', or null for all
    const search = searchParams.get('search') || ''
    const sortBy = searchParams.get('sortBy') || 'createdAt'
    const sortOrder = searchParams.get('sortOrder') || 'desc'
    
    // Build query
    const query = {}
    
    if (status && ['sent', 'failed', 'pending'].includes(status)) {
      query.status = status
    }
    
    if (search) {
      query.$or = [
        { recipientEmail: { $regex: search, $options: 'i' } },
        { recipientName: { $regex: search, $options: 'i' } },
        { employeeCode: { $regex: search, $options: 'i' } },
      ]
    }
    
    const skip = (page - 1) * limit
    const sortObj = { [sortBy]: sortOrder === 'asc' ? 1 : -1 }
    
    // Check if OnboardingEmail model is available
    if (!OnboardingEmail) {
      console.error('OnboardingEmail model not available')
      return NextResponse.json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, pages: 0 },
        stats: { sent: 0, failed: 0, pending: 0, total: 0 },
        onboardingEmailsEnabled: true,
      })
    }
    
    const [emails, total, settings] = await Promise.all([
      OnboardingEmail.find(query)
        .populate('employee', 'firstName lastName employeeCode profilePicture')
        .populate('retriedBy', 'email')
        .sort(sortObj)
        .skip(skip)
        .limit(limit)
        .lean()
        .catch(err => {
          console.error('Failed to fetch onboarding emails:', err.message)
          return []
        }),
      OnboardingEmail.countDocuments(query).catch(() => 0),
      CompanySettings?.findOne().select('notifications.onboardingEmailsEnabled').lean().catch(() => null),
    ])
    
    // Get stats - with fallback to handle errors
    const [sentCount, failedCount, pendingCount] = await Promise.all([
      OnboardingEmail.countDocuments({ status: 'sent' }).catch(() => 0),
      OnboardingEmail.countDocuments({ status: 'failed' }).catch(() => 0),
      OnboardingEmail.countDocuments({ status: 'pending' }).catch(() => 0),
    ])
    
    // Get onboarding emails enabled status (default to true if not set)
    const onboardingEmailsEnabled = settings?.notifications?.onboardingEmailsEnabled !== false
    
    return NextResponse.json({
      success: true,
      data: emails,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      stats: {
        sent: sentCount,
        failed: failedCount,
        pending: pendingCount,
        total: sentCount + failedCount + pendingCount,
      },
      onboardingEmailsEnabled,
    })
  } catch (error) {
    console.error('Get onboarding emails error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to fetch onboarding emails' },
      { status: 500 }
    )
  }
}

/**
 * PATCH - Toggle onboarding emails enabled/disabled
 */
export async function PATCH(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['CompanySettings'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { CompanySettings } = models
    
    // Only admin can toggle this setting
    if (user.role !== 'admin') {
      return NextResponse.json({ success: false, message: 'Only admin can change this setting' }, { status: 403 })
    }
    
    const body = await request.json()
    const { enabled } = body
    
    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { success: false, message: 'enabled must be a boolean' },
        { status: 400 }
      )
    }
    
    // Update or create company settings
    const settings = await CompanySettings.findOneAndUpdate(
      {},
      { $set: { 'notifications.onboardingEmailsEnabled': enabled } },
      { new: true, upsert: true }
    )
    
    console.log(`[Onboarding Emails] Auto-send ${enabled ? 'enabled' : 'disabled'} by ${user.email}`)
    
    return NextResponse.json({
      success: true,
      message: `Onboarding emails ${enabled ? 'enabled' : 'disabled'} successfully`,
      onboardingEmailsEnabled: enabled,
    })
  } catch (error) {
    console.error('Toggle onboarding emails error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update setting' },
      { status: 500 }
    )
  }
}
