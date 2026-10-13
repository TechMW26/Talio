import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getMiraSettings } from '@/lib/miraAccess.server'
import { createMiraBridgeCredential, elevenAgentRequest, miraAgentCanStart, MIRA_AGENT_LANGUAGES } from '@/lib/miraVoiceAgent.server'
import { sanitizeMiraPreferences, miraAgentVoice } from '@/lib/miraVoices'
import { rateLimit } from '@/lib/security/rateLimiter'
import { MIRA_CHAT_STORE_OPTIONS, readMiraTokens } from '@/lib/miraChatStore.server'
import { loadMiraVoiceContext } from '@/lib/miraVoiceContext'

export const dynamic = 'force-dynamic'
export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, MIRA_CHAT_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const bucket = await rateLimit('MIRA_AGENT_SESSION', `${auth.tenant.databaseName}:${auth.user._id}`)
    if (!bucket.allowed) return NextResponse.json({ success: false, message: 'Please wait before starting another voice session' }, { status: 429 })
    const balance = await readMiraTokens(auth.database, String(auth.user._id || auth.user.userId))
    if (!balance.tokensRemaining) return NextResponse.json({ success: false, message: 'Your monthly Mira allowance is exhausted' }, { status: 429 })
    const { agent } = await getMiraSettings(auth.database)
    if (!miraAgentCanStart(agent)) return NextResponse.json({ success: false, message: 'An administrator needs to sync the Mira voice agent in Settings → MIRA' }, { status: 409 })
    const profile = await auth.database.get('users', String(auth.user._id || auth.user.userId))
    const language = MIRA_AGENT_LANGUAGES.includes(profile?.miraPreferences?.lastLanguage) ? profile.miraPreferences.lastLanguage : 'en'
    const { voiceId, voiceName, notice } = miraAgentVoice(sanitizeMiraPreferences(profile?.miraPreferences).voiceId)
    // Existing clients can still finish/start their signed-URL session. New
    // clients explicitly request WebRTC; never silently downgrade a live call.
    const raw = await request.text()
    let payload = {}
    try { if (raw.trim()) payload = JSON.parse(raw) }
    catch { return NextResponse.json({ success: false, message: 'Invalid call request' }, { status: 400 }) }
    const transport = raw.trim() ? payload?.transport : 'websocket'
    if (!['webrtc', 'websocket'].includes(transport)) return NextResponse.json({ success: false, message: 'Choose a supported call transport' }, { status: 400 })
    const userContext = await loadMiraVoiceContext(auth.database, auth.user, profile, auth.tenant)
    const result = await elevenAgentRequest(`/conversation/${transport === 'webrtc' ? 'token' : 'get-signed-url'}?agent_id=${encodeURIComponent(agent.agentId)}`)
    const connection = transport === 'webrtc' ? { conversationToken: result.token } : { signedUrl: result.signed_url }
    if (!Object.values(connection)[0]) throw new Error('Provider did not return a call credential')
    return NextResponse.json({ success: true, connectionType: transport, ...connection, language, voiceId, voiceName, voiceNotice: notice, bridgeCredential: await createMiraBridgeCredential(auth.user, auth.tenant, userContext) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ success: false, message: error.status ? error.message : 'Could not start Mira voice' }, { status: error.status || 500 })
  }
}
