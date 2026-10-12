import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getMiraSettings } from '@/lib/miraAccess.server'
import { miraAgentPromptHash, syncMiraAgent } from '@/lib/miraVoiceAgent.server'
import { rateLimit } from '@/lib/security/rateLimiter'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function GET(request) {
  const auth = await getAuthAndDatabase(request)
  if (!auth.success || auth.user.role !== 'admin') return NextResponse.json({ success: false, message: 'Administrator access is required' }, { status: auth.status || 403 })
  const { agent } = await getMiraSettings(auth.database)
  return NextResponse.json({ success: true, agent, needsSync: agent?.promptHash !== miraAgentPromptHash() }, { headers: { 'Cache-Control': 'no-store' } })
}
export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    if (auth.user.role !== 'admin') return NextResponse.json({ success: false, message: 'Administrator access is required' }, { status: 403 })
    const bucket = await rateLimit('MIRA_AGENT_SYNC', `${auth.tenant.databaseName}:${auth.user._id}`)
    if (!bucket.allowed) return NextResponse.json({ success: false, message: 'Please wait before syncing again' }, { status: 429 })
    const agent = await syncMiraAgent(auth.database, auth.user, auth.tenant.databaseName)
    return NextResponse.json({ success: true, agent, needsSync: false })
  } catch (error) {
    return NextResponse.json({ success: false, message: error.status ? error.message : 'Could not sync the Mira agent' }, { status: error.status || 500 })
  }
}
