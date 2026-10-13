import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { verifyMiraBridgeCredential } from '@/lib/miraVoiceAgent.server'
import { MIRA_CHAT_STORE_OPTIONS, checkAndDeductMiraToken, miraMonth } from '@/lib/miraChatStore.server'

export const dynamic = 'force-dynamic'
// Native speech bypasses chat generation, not authorization or usage limits.
// One small, idempotent accounting request per final utterance; no LLM call.
export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, MIRA_CHAT_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const { bridgeCredential, turn } = await request.json()
    if (!Number.isSafeInteger(turn) || turn < 1 || turn > 1000 || typeof bridgeCredential !== 'string') return NextResponse.json({ success: false, message: 'Invalid voice turn' }, { status: 400 })
    const call = await verifyMiraBridgeCredential(bridgeCredential)
    const userId = String(auth.user._id || auth.user.userId)
    if (call.userId !== userId || call.databaseName !== auth.tenant.databaseName || call.tokenId !== auth.user.tokenId || call.authVersion !== (auth.user.authVersion || 0)) return NextResponse.json({ success: false, message: 'Invalid voice session' }, { status: 403 })
    const key = createHash('sha256').update(`${bridgeCredential}:${turn}`).digest('hex')
    const balance = await checkAndDeductMiraToken(auth.database, userId, miraMonth(), key)
    return NextResponse.json({ success: balance.allowed, ...balance, ...(!balance.allowed ? { message: 'Your monthly Mira allowance is exhausted' } : {}) }, { status: balance.allowed ? 200 : 429, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ success: false, message: error.status ? error.message : 'Could not authorize this voice turn' }, { status: error.status || 403 })
  }
}
