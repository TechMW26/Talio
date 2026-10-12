import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getMiraSettings } from '@/lib/miraAccess.server'
import { createMiraBridgeCredential, elevenAgentRequest, miraAgentPromptHash } from '@/lib/miraVoiceAgent.server'
import { sanitizeMiraPreferences, miraAgentVoice } from '@/lib/miraVoices'
import { rateLimit } from '@/lib/security/rateLimiter'

export const dynamic = 'force-dynamic'
export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const bucket = await rateLimit('MIRA_AGENT_SESSION', `${auth.tenant.databaseName}:${auth.user._id}`)
    if (!bucket.allowed) return NextResponse.json({ success: false, message: 'Please wait before starting another voice session' }, { status: 429 })
    const { agent } = await getMiraSettings(auth.database)
    if (!agent?.agentId || agent.promptHash !== miraAgentPromptHash()) return NextResponse.json({ success: false, message: 'An administrator needs to sync the Mira voice agent in Settings → MIRA' }, { status: 409 })
    const profile = await auth.database.get('users', String(auth.user._id || auth.user.userId))
    const { voiceId, notice } = miraAgentVoice(sanitizeMiraPreferences(profile?.miraPreferences).voiceId)
    const result = await elevenAgentRequest(`/conversation/get-signed-url?agent_id=${encodeURIComponent(agent.agentId)}`)
    return NextResponse.json({ success: true, signedUrl: result.signed_url, voiceId, voiceNotice: notice, bridgeCredential: await createMiraBridgeCredential(auth.user, auth.tenant) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ success: false, message: error.status ? error.message : 'Could not start Mira voice' }, { status: error.status || 500 })
  }
}
