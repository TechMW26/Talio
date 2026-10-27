import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { MIRA_PROACTIVE_STORE_OPTIONS, getMiraProactiveFeed, updateMiraProactiveEvent } from '@/lib/miraProactive.server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const headers = { 'Cache-Control': 'private, no-store' }
export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, MIRA_PROACTIVE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401, headers })
    const current = await auth.database.get('users', String(auth.user._id))
    return NextResponse.json({ success: true, data: await getMiraProactiveFeed(auth.database, current) }, { headers })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Mira attention is temporarily unavailable.' }, { status: error.status || 503, headers }) }
}
export async function PATCH(request) {
  try {
    const auth = await getAuthAndDatabase(request, MIRA_PROACTIVE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401, headers })
    const current = await auth.database.get('users', String(auth.user._id))
    return NextResponse.json({ success: true, data: await updateMiraProactiveEvent(auth.database, current, await request.json()) }, { headers })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Could not update this attention item.' }, { status: error.status || 400, headers }) }
}
