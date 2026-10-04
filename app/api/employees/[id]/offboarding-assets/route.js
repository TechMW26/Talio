import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'
import { updateOffboardingAssetClearance } from '@/lib/hrms/offboardingAssets.server'
import { isFeatureEnabled } from '@/lib/planFeatures'
import queryCache from '@/lib/queryCache'

export const dynamic = 'force-dynamic'
const HR_ROLES = new Set(['admin', 'hr', 'superadmin', 'super_admin'])
const errorResponse = (message, status) => NextResponse.json({ success: false, message }, { status })

async function handle(request, { params }) {
  try {
    const { id } = await params
    if (!/^[a-f\d]{24}$/i.test(id)) return errorResponse('Invalid employee ID', 400)
    const auth = await getAuthAndDatabase(request, { queryFields: { assets: ['assignedTo'] } })
    if (!auth.success) return errorResponse(auth.message || 'Unauthorized', auth.status || 401)
    if (!HR_ROLES.has(auth.user.role)) return errorResponse('Only HR can manage offboarding asset clearance', 403)
    if (!isFeatureEnabled(auth.companyFeatures, 'exitManagement')) return errorResponse('Exit management is disabled for this tenant', 403)
    let input = {}
    if (request.method === 'PATCH') {
      try { input = await request.json() } catch { return errorResponse('Invalid JSON request body', 400) }
      if (!['return', 'waive'].includes(input.action)) return errorResponse('Unsupported asset clearance action', 400)
      if (!/^[a-f\d]{24}$/i.test(input.assetId)) return errorResponse('Invalid asset ID', 400)
    }
    const { employee, clearance } = await updateOffboardingAssetClearance(auth.database, id, auth.user, input)
    await clearCachePattern(buildCachePattern({ tenantId: auth.tenant.databaseName, namespace: 'employee:detail' })).catch(() => {})
    queryCache.clearPattern('employee')
    return NextResponse.json({ success: true, message: request.method === 'GET' ? 'Asset clearance loaded' : clearance.summary.complete ? 'All assigned assets are cleared' : 'Asset return recorded', data: { employee: { _id: employee._id, name: `${employee.firstName || ''} ${employee.lastName || ''}`.trim() }, checklist: clearance.checklist, summary: clearance.summary } })
  } catch (error) {
    console.error('[OffboardingAssets]', error)
    return errorResponse(error.status ? error.message : 'Unable to update the offboarding asset checklist', error.status || 500)
  }
}
export const GET = handle
export const PATCH = handle
