import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { verifyMiraBridgeCredential } from '@/lib/miraVoiceAgent.server'
import { miraDeepSeekRequest, streamMiraAgentDeepSeek } from '@/lib/miraAgentGateway'
import { MIRA_DIRECT_VOICE_TOOLS } from '@/lib/miraDirectVoice'
import { resolveMiraSpokenLanguage } from '@/lib/miraLanguage'
import { MIRA_CHAT_STORE_OPTIONS, checkAndDeductMiraToken, miraMonth } from '@/lib/miraChatStore.server'
import { rateLimit } from '@/lib/security/rateLimiter'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function POST(request) {
  let validated = false
  try {
    const auth = await getAuthAndDatabase(request, MIRA_CHAT_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    const raw = await request.text()
    if (raw.length > 48000) return NextResponse.json({ message: 'Voice context is too large.' }, { status: 413 })
    const body = JSON.parse(raw)
    let call
    try { call = await verifyMiraBridgeCredential(body?.bridgeCredential) }
    catch { return NextResponse.json({ message: 'Voice session expired. Please reconnect.' }, { status: 401 }) }
    const userId = String(auth.user._id)
    if (call.userId !== userId || call.databaseName !== auth.tenant.databaseName || call.tokenId !== auth.user.tokenId || call.authVersion !== (auth.user.authVersion || 0)) return NextResponse.json({ message: 'Invalid voice session.' }, { status: 403 })
    if (!Number.isSafeInteger(body.turn) || body.turn < 1 || body.turn > 1000 || !Array.isArray(body.messages) || body.messages.length > 27) return NextResponse.json({ message: 'Invalid voice turn.' }, { status: 400 })
    const payload = { messages: body.messages, tools: body.messages.at(-1)?.role === 'tool' ? [] : MIRA_DIRECT_VOICE_TOOLS }
    miraDeepSeekRequest(payload)
    const text = body.messages.filter(m => m.role === 'user').at(-1)?.content
    if (!text || text.length > 3000) return NextResponse.json({ message: 'Invalid utterance.' }, { status: 400 })
    validated = true
    if (!(await rateLimit('MIRA_AGENT_GATEWAY', `${auth.tenant.databaseName}:${userId}`)).allowed) return NextResponse.json({ message: 'Please wait before another voice turn.' }, { status: 429 })
    const key = `${call.jti}:${body.turn}:${createHash('sha256').update(text).digest('hex')}`
    const balance = await checkAndDeductMiraToken(auth.database, userId, miraMonth(), key)
    if (!balance.allowed) return NextResponse.json({ message: 'Your monthly Mira allowance is exhausted.' }, { status: 429 })
    const language = resolveMiraSpokenLanguage(text, auth.user.miraLanguage)
    if (language !== (auth.user.miraLanguage || 'en')) await auth.database.mutate('users', userId, fresh => ({ ...fresh, miraPreferences: { ...fresh.miraPreferences, lastLanguage: language }, updatedAt: new Date() }))
    const stream = await streamMiraAgentDeepSeek(payload, { signal: request.signal, language, userContext: call.userContext, direct: true })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no', 'X-Mira-Language': language,
      'X-Mira-Balance': JSON.stringify({ tokensUsed: balance.tokensUsed, tokenLimit: balance.tokenLimit, tokensRemaining: balance.tokensRemaining }),
    } })
  } catch { return NextResponse.json({ message: 'Voice reply unavailable. Please try again.' }, { status: validated ? 502 : 400 }) }
}
