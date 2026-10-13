import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { verifyMiraBridgeCredential, miraBridgeAuthRequest, MIRA_AGENT_LANGUAGES } from '@/lib/miraVoiceAgent.server'
import { miraDeepSeekRequest, miraGatewayTurnKey, streamMiraAgentDeepSeek } from '@/lib/miraAgentGateway'
import { MIRA_CHAT_STORE_OPTIONS, checkAndDeductMiraToken, miraMonth } from '@/lib/miraChatStore.server'
import { rateLimit } from '@/lib/security/rateLimiter'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function POST(request) {
  try {
    if (Number(request.headers.get('content-length')) > 256000) return NextResponse.json({ error: 'Conversation too large' }, { status: 413 })
    const raw = await request.text()
    if (raw.length > 256000) return NextResponse.json({ error: 'Conversation too large' }, { status: 413 })
    const body = JSON.parse(raw)
    let payload
    // Agents nest customLlmExtraBody in elevenlabs_extra_body, rather than
    // spreading it into the OpenAI request. Keep direct-call compatibility.
    try { payload = await verifyMiraBridgeCredential(body.elevenlabs_extra_body?.mira_bridge_credential ?? body.mira_bridge_credential) }
    catch { return NextResponse.json({ error: 'Invalid or expired voice session' }, { status: 401 }) }
    const bucket = await rateLimit('MIRA_AGENT_GATEWAY', `${payload.databaseName}:${payload.userId}`)
    if (!bucket.allowed) return NextResponse.json({ error: 'Voice turn limit reached' }, { status: 429 })
    const auth = await getAuthAndDatabase(await miraBridgeAuthRequest(payload, request.url), MIRA_CHAT_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ error: auth.message }, { status: auth.status || 401 })
    miraDeepSeekRequest(body)
    const userId = String(auth.user._id || auth.user.userId)
    const balance = await checkAndDeductMiraToken(auth.database, userId, miraMonth(), miraGatewayTurnKey(body, payload.jti))
    if (!balance.allowed) return NextResponse.json({ error: 'Your monthly Mira allowance is exhausted' }, { status: 429 })
    const profile = await auth.database.get('users', userId)
    const language = profile?.miraPreferences?.lastLanguage || 'en'
    const stream = await streamMiraAgentDeepSeek(body, { signal: request.signal, language, userContext: payload.userContext, onLanguage: async selected => {
      if (!MIRA_AGENT_LANGUAGES.includes(selected) || selected === language) return
      await auth.database.mutate('users', userId, fresh => ({ ...fresh, miraPreferences: { ...fresh.miraPreferences, lastLanguage: selected }, updatedAt: new Date() }))
    } })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } })
  } catch {
    return NextResponse.json({ error: 'Invalid voice turn' }, { status: 400 })
  }
}
