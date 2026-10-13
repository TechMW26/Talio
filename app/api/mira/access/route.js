import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getMiraAccess, getMiraSettings, updateMiraSettings } from '@/lib/miraAccess.server'
import { getIO } from '@/lib/socket'

export const dynamic = 'force-dynamic'
export async function GET(request) {
  const auth = await getAuthAndDatabase(request)
  if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
  const settings = await getMiraSettings(auth.database)
  const access = await getMiraAccess(auth.database, auth.user, settings)
  return NextResponse.json({ success: true, access, settings: auth.user.role === 'admin' ? settings : undefined, canManage: auth.user.role === 'admin' }, { headers: { 'Cache-Control': 'no-store' } })
}
export async function PUT(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const { enabled, allowedLevels } = await request.json()
    await updateMiraSettings(auth.database, auth.user, { enabled, allowedLevels })
    // Tenant-scoped invalidation only; each recipient rechecks its own access.
    getIO()?.emit('mira-access-updated', { refresh: true }, auth.tenant.databaseName)
    return NextResponse.json({ success: true, settings: await getMiraSettings(auth.database) })
  } catch (error) {
    return NextResponse.json({ success: false, message: error.status ? error.message : 'Could not save Mira access' }, { status: error.status || 500 })
  }
}
