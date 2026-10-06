import { NextResponse } from 'next/server'
import { getFirestoreSystemDatabase, getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { collectFirestorePages } from '@/lib/platform/firestoreQueries.server'
import { getAuthAndDatabase } from '@/lib/auth'
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
    const database = await getFirestoreTenantDatabase(tenant.databaseName, { queryFields: { users: ['isActive', 'profileCompletion.profileCompletionDeadline'] } })

    // Find users who:
    // 1. Are currently active
    // 2. Have a profile completion deadline that has passed
    // 3. Profile is not complete
    // 4. Are NOT admins
    const overdueUsers = (await collectFirestorePages(database, 'users', { filters: [
      { field: 'isActive', operator: '==', value: true },
      { field: 'profileCompletion.profileCompletionDeadline', operator: '<', value: now },
    ] })).filter(user => !['admin', 'super_admin'].includes(user.role) && user.profileCompletion?.status !== 'complete')

    if (overdueUsers.length === 0) {
      return results
    }

    // LOG overdue users but DO NOT deactivate them
    for (const user of overdueUsers) {
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
    const system = await getFirestoreSystemDatabase({ queryFields: { tenantcompanies: ['isActive', 'serviceStatus', 'isSetupComplete'] } })
    const activeTenants = await collectFirestorePages(system, 'tenantcompanies', { filters: [
      { field: 'isActive', operator: '==', value: true }, { field: 'serviceStatus', operator: 'in', value: ['active', 'trial'] }, { field: 'isSetupComplete', operator: '==', value: true },
    ] })

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
      if (tenantResult.overdue > 0 && process.env.TALIO_LOCAL_ACCEPTANCE !== '1') {
        global.io?.to(`tenant:${tenant.databaseName}`).emit('users:profile-overdue', {
          count: tenantResult.overdue, reason: 'profile_incomplete', timestamp: now,
        })
      }
    }

    console.log(`[Profile Deadline Check] Completed. Total overdue (NOT deactivated): ${allResults.totalOverdue}`)

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
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    if (!['admin', 'hr'].includes(auth.user.role)) return NextResponse.json({ success: false, message: 'Admin access required' }, { status: 403 })
    // A tenant administrator may only trigger their own tenant, never the global sweep.
    const result = await checkProfileDeadlinesForTenant({ databaseName: auth.tenant.databaseName, name: auth.tenant.companyName, slug: auth.tenant.companySlug }, new Date())
    return NextResponse.json({ success: !result.error, data: result }, { status: result.error ? 500 : 200 })

  } catch (error) {
    console.error('[Profile Deadline Check Manual] Error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to run profile deadline check'
    }, { status: 500 })
  }
}
