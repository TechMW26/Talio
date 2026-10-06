import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'
import { getProfileStore, getProfileRecords, populateProfileEmployee } from '@/lib/platform/firestoreProfile.server'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: 401 })
    const { user, tenant } = auth
    const cacheKey = buildCacheKey({ tenantId: tenant.databaseName, role: user.role, userId: user._id || user.userId, namespace: 'profile' })
    const cached = await getCache(cacheKey)
    if (cached) return NextResponse.json(cached)
    const store = await getProfileStore(tenant.databaseName)
    const records = await getProfileRecords(store, user._id || user.userId)
    if (!records.user) return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    const response = { success: true, data: {
      user: { _id: records.user._id, email: records.user.email, role: records.user.role },
      employee: await populateProfileEmployee(store, records.employee),
    } }
    await setCache(cacheKey, response, 10 * 60)
    return NextResponse.json(response)
  } catch (error) {
    console.error('Get profile error:', error)
    return NextResponse.json({ success: false, message: 'Failed to load profile' }, { status: 500 })
  }
}
