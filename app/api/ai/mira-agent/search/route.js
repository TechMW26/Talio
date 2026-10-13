import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { verifyMiraBridgeCredential } from '@/lib/miraVoiceAgent.server'
import { MIRA_CHAT_STORE_OPTIONS, checkAndDeductMiraToken, hasMiraVoiceReceipt, miraMonth } from '@/lib/miraChatStore.server'
import { rateLimit } from '@/lib/security/rateLimiter'
import { getMiraInternetContext, miraPublicVoiceQuery } from '@/lib/miraInternet'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, MIRA_CHAT_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const { bridgeCredential, turn, message } = await request.json()
    if (!Number.isSafeInteger(turn) || turn < 1 || turn > 1000 || typeof bridgeCredential !== 'string') return NextResponse.json({ success: false, message: 'Invalid voice turn' }, { status: 400 })
    const query = miraPublicVoiceQuery(message)
    if (!query) return NextResponse.json({ success: false, message: 'Use the private Talio tool for workplace data. Public search accepts only a short public question.' }, { status: 400 })
    const call = await verifyMiraBridgeCredential(bridgeCredential)
    const userId = String(auth.user._id || auth.user.userId)
    if (call.userId !== userId || call.databaseName !== auth.tenant.databaseName || call.tokenId !== auth.user.tokenId || call.authVersion !== (auth.user.authVersion || 0)) return NextResponse.json({ success: false, message: 'Invalid voice session' }, { status: 403 })
    const bucket = await rateLimit('MIRA_AGENT_SEARCH', `${auth.tenant.databaseName}:${userId}`)
    if (!bucket.allowed) return NextResponse.json({ success: false, message: 'Please wait before another lookup' }, { status: 429 })
    // Same retry key as /usage: authorizes this turn without charging twice.
    const key = createHash('sha256').update(`${bridgeCredential}:${turn}`).digest('hex')
    const balance = call.accounting === 'gateway'
      ? { allowed: await hasMiraVoiceReceipt(auth.database, userId, call.jti, message) }
      : await checkAndDeductMiraToken(auth.database, userId, miraMonth(), key)
    if (!balance.allowed) return NextResponse.json({ success: false, message: 'Your monthly Mira allowance is exhausted' }, { status: 429 })
    const result = await getMiraInternetContext(`Search the web for ${query}`, {})
    return NextResponse.json({ success: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ success: false, message: 'Public lookup is unavailable. Do not claim internet verification.' }, { status: error instanceof SyntaxError ? 400 : 502 })
  }
}
