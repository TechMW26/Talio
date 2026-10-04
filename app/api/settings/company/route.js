import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { sanitizeCompanySettingsForClient } from '@/lib/companySettingsUtils'
import { readOrUpdateCompanySettings } from '@/lib/companySettings.server'
import { buildCacheKey, buildCachePattern, getCache, setCache, clearCachePattern } from '@/lib/cache'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    const cacheKey = buildCacheKey({ tenantId: auth.tenant.databaseName, role: 'shared', userId: 'tenant', namespace: 'settings:company' })
    const cached = await getCache(cacheKey)
    if (cached) return NextResponse.json({ ...cached, cached: true })
    const settings = await readOrUpdateCompanySettings(auth.database)
    const response = { success: true, data: sanitizeCompanySettingsForClient(settings) }
    await setCache(cacheKey, response, 5 * 60).catch(() => {})
    return NextResponse.json(response)
  } catch (error) {
    console.error('[CompanySettings] Read failed:', error.code || error.name)
    return NextResponse.json({ success: false, message: 'Failed to fetch company settings' }, { status: 500 })
  }
}

export async function PUT(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    if (!['admin', 'hr'].includes(auth.user.role)) return NextResponse.json({ success: false, message: 'Only admin and HR can update company settings' }, { status: 403 })
    const settings = await readOrUpdateCompanySettings(auth.database, await request.json())
    await clearCachePattern(buildCachePattern({ tenantId: auth.tenant.databaseName, role: 'shared', namespace: 'settings:company' })).catch(() => {})
    return NextResponse.json({ success: true, message: 'Company settings updated successfully', data: sanitizeCompanySettingsForClient(settings) })
  } catch (error) {
    console.error('[CompanySettings] Update failed:', error.code || error.name)
    return NextResponse.json({ success: false, message: error instanceof TypeError ? error.message : 'Failed to update company settings' }, { status: error instanceof TypeError ? 400 : 500 })
  }
}

