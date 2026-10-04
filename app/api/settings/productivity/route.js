import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getProductivitySettings, saveProductivitySettings } from '@/lib/productivitySettings.server'

export const dynamic = 'force-dynamic'
async function handle(request, write) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const data = write
      ? await saveProductivitySettings(auth.database, auth.user, (await request.json()).screenshotsEnabled)
      : await getProductivitySettings(auth.database)
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof SyntaxError ? 'Invalid JSON request' : error.status ? error.message : 'Unable to load or save productivity settings' }, { status: error instanceof SyntaxError ? 400 : error.status || 500 })
  }
}
export const GET = request => handle(request, false)
export const PUT = request => handle(request, true)
