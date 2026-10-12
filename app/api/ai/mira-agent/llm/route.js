import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { verifyMiraBridgeCredential, miraBridgeAuthRequest } from '@/lib/miraVoiceAgent.server'
import { miraAgentCompletion, miraAgentSSE } from '@/lib/miraAgentGateway'
import { rateLimit } from '@/lib/security/rateLimiter'

export const dynamic = 'force-dynamic'
export async function POST(request) {
  try {
    if (Number(request.headers.get('content-length')) > 256000) return NextResponse.json({ error: 'Conversation too large' }, { status: 413 })
    const raw = await request.text()
    if (raw.length > 256000) return NextResponse.json({ error: 'Conversation too large' }, { status: 413 })
    const body = JSON.parse(raw)
    let payload
    try { payload = await verifyMiraBridgeCredential(body.mira_bridge_credential) }
    catch { return NextResponse.json({ error: 'Invalid or expired voice session' }, { status: 401 }) }
    const bucket = await rateLimit('MIRA_AGENT_GATEWAY', `${payload.databaseName}:${payload.userId}`)
    if (!bucket.allowed) return NextResponse.json({ error: 'Voice turn limit reached' }, { status: 429 })
    const auth = await getAuthAndDatabase(await miraBridgeAuthRequest(payload, request.url))
    if (!auth.success) return NextResponse.json({ error: auth.message }, { status: auth.status || 401 })
    const completion = miraAgentCompletion(body.messages)
    return new Response(miraAgentSSE(completion), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Invalid voice turn' }, { status: 400 })
  }
}
