import { NextResponse } from 'next/server'
import { connectSuperadminDB } from '@/lib/superadminDb'
import getTenantCompanyModel from '@/models/TenantCompany'
import { getTenantModels } from '@/lib/tenantModels'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Process profile deadline checks for a single tenant
 */
async function checkProfileDeadlinesForTenant(tenant, now) {
  const results = {
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    suspended: 0,
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
    const usersToSuspend = await User.find({
      isActive: true,
      'profileCompletion.profileCompletionDeadline': { $lt: now },
      'profileCompletion.status': { $ne: 'complete' }
    }).select('_id email profileCompletion')

    if (usersToSuspend.length === 0) {
      return results
    }

    // Suspend each user
    for (const user of usersToSuspend) {
      try {
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              isActive: false,
              suspensionReason: 'profile_incomplete',
              suspendedAt: now
            }
          }
        )
        
        results.suspended++
        results.users.push({
          id: user._id.toString(),
          email: user.email,
          deadline: user.profileCompletion?.profileCompletionDeadline
        })
        
      } catch (error) {
        console.error(`[Profile Deadline Check] Error suspending user ${user.email} in tenant ${tenant.slug}:`, error)
        results.errors.push({
          id: user._id.toString(),
          email: user.email,
          error: error.message
        })
      }
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
    // Verify cron secret
    const cronSecret = request.headers.get('x-cron-secret')
    const authHeader = request.headers.get('authorization')
    const expectedSecret = process.env.CRON_SECRET
    
    // Accept either x-cron-secret header or Bearer token with cron secret
    const isValidSecret = 
      (expectedSecret && cronSecret === expectedSecret) ||
      (expectedSecret && authHeader === `Bearer ${expectedSecret}`)
    
    if (expectedSecret && !isValidSecret) {
      console.log('[Profile Deadline Check] Invalid cron secret')
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

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
      totalSuspended: 0,
      tenantResults: []
    }

    // Process each tenant
    for (const tenant of activeTenants) {
      console.log(`[Profile Deadline Check] Processing tenant: ${tenant.name}`)
      const tenantResult = await checkProfileDeadlinesForTenant(tenant, now)
      allResults.tenantResults.push(tenantResult)
      allResults.totalSuspended += tenantResult.suspended
    }

    console.log(`[Profile Deadline Check] Completed. Total suspended: ${allResults.totalSuspended}`)

    // Emit Socket.IO event if available (for real-time dashboard updates)
    if (global.io && allResults.totalSuspended > 0) {
      global.io.emit('users:suspended', {
        count: allResults.totalSuspended,
        reason: 'profile_incomplete',
        timestamp: now
      })
    }

    return NextResponse.json({
      success: true,
      message: `Suspended ${allResults.totalSuspended} user(s) for incomplete profiles across ${activeTenants.length} tenants`,
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
