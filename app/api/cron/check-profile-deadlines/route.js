import { NextResponse } from 'next/server'
import { connectSuperadminDB } from '@/lib/superadminDb'
import getTenantCompanyModel from '@/models/TenantCompany'
import { getTenantModels } from '@/lib/tenantModels'
import { getCronAuthErrorResponse } from '@/lib/cronAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ============================================================================
// IMPORTANT: Auto-deactivation has been DISABLED.
// Previously, this cron job would automatically set isActive=false for ALL
// non-admin users whose profile completion deadline had passed. This caused
// mass account deactivation across all tenants since most users never complete
// the Aadhaar verification + profile flow within 7 days.
//
// Now this cron job only LOGS and REPORTS overdue users without deactivating.
// Admins can still manually suspend users via the admin panel if needed.
// ============================================================================

/**
 * Process profile deadline checks for a single tenant
 * NOTE: This now only reports overdue users - it does NOT deactivate them.
 */
async function checkProfileDeadlinesForTenant(tenant, now) {
  const results = {
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    overdue: 0,
    users: [],
    errors: []
  }

  try {
    // Get tenant-specific User model
    const models = await getTenantModels(tenant.databaseName, ['User'])
    const { User } = models

    // Find users who:
    // 1. Are currently active
    // 2. Have a profile completion deadline that has passed
    // 3. Profile is not complete
    // 4. Are NOT admins
    const overdueUsers = await User.find({
      isActive: true,
      role: { $ne: 'admin' },
      'profileCompletion.profileCompletionDeadline': { $lt: now },
      'profileCompletion.status': { $ne: 'complete' }
    }).select('_id email role profileCompletion')

    if (overdueUsers.length === 0) {
      return results
    }

    // LOG overdue users but DO NOT deactivate them
    for (const user of overdueUsers) {
      console.log(
        `[Profile Deadline Check] OVERDUE (not deactivated): ${user.email} in tenant ${tenant.slug}, ` +
        `deadline was ${user.profileCompletion?.profileCompletionDeadline?.toISOString()}`
      )

      results.overdue++
      results.users.push({
        id: user._id.toString(),
        email: user.email,
        deadline: user.profileCompletion?.profileCompletionDeadline
      })
    }

    return results

  } catch (error) {
    console.error(`[Profile Deadline Check] Error processing tenant ${tenant.slug}:`, error)
    return { ...results, error: error.message }
  }
}

/**
 * GET /api/cron/check-profile-deadlines
 * Cron job to check and suspend users who haven't completed their profile
 * 
 * MULTI-TENANT: Iterates over ALL active tenants and processes each one.
 * 
 * Security: Protected by CRON_SECRET
 */
export async function GET(request) {
  try {
    const authError = getCronAuthErrorResponse(request)
    if (authError) return authError

    const now = new Date()
    console.log(`[Profile Deadline Check] Starting multi-tenant processing at ${now.toISOString()}`)

    // Connect to superadmin DB and get all active tenants
    await connectSuperadminDB()
    const TenantCompany = await getTenantCompanyModel()

    const activeTenants = await TenantCompany.find({
      isActive: true,
      serviceStatus: { $in: ['active', 'trial'] },
      isSetupComplete: true
    }).lean()

    console.log(`[Profile Deadline Check] Found ${activeTenants.length} active tenants to process`)

    const allResults = {
      tenantsProcessed: activeTenants.length,
      totalOverdue: 0,
      tenantResults: []
    }

    // Process each tenant (report only, no deactivation)
    for (const tenant of activeTenants) {
      console.log(`[Profile Deadline Check] Processing tenant: ${tenant.name}`)
      const tenantResult = await checkProfileDeadlinesForTenant(tenant, now)
      allResults.tenantResults.push(tenantResult)
      allResults.totalOverdue += tenantResult.overdue
    }

    console.log(`[Profile Deadline Check] Completed. Total overdue (NOT deactivated): ${allResults.totalOverdue}`)

    // Emit Socket.IO event if available (for dashboard awareness, not deactivation)
    if (global.io && allResults.totalOverdue > 0) {
      global.io.emit('users:profile-overdue', {
        count: allResults.totalOverdue,
        reason: 'profile_incomplete',
        timestamp: now
      })
    }

    return NextResponse.json({
      success: true,
      message: `Found ${allResults.totalOverdue} user(s) with overdue profiles across ${activeTenants.length} tenants (no accounts deactivated)`,
      data: allResults
    })

  } catch (error) {
    console.error('[Profile Deadline Check] Error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to check profile deadlines'
    }, { status: 500 })
  }
}

/**
 * POST /api/cron/check-profile-deadlines
 * Manual trigger for profile deadline check (admin only)
 */
export async function POST(request) {
  try {
    // This endpoint requires admin authentication
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    // Verify token and check if user is admin
    const { jwtVerify } = await import('jose')
    const secret = new TextEncoder().encode(process.env.JWT_SECRET)

    const { payload } = await jwtVerify(token, secret)

    if (!payload || !payload.userId) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Connect to tenant DB to verify user role
    if (!payload.databaseName) {
      return NextResponse.json({ success: false, message: 'Invalid session - please log in again' }, { status: 401 })
    }

    const models = await getTenantModels(payload.databaseName, ['User'])
    const user = await models.User.findById(payload.userId).select('role')

    if (!user || !['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Admin access required' }, { status: 403 })
    }

    // Call the GET handler logic
    return GET(request)

  } catch (error) {
    console.error('[Profile Deadline Check Manual] Error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to run profile deadline check'
    }, { status: 500 })
  }
}
