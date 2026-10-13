import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { createMiraBridgeCredential } from '@/lib/miraVoiceAgent.server'
import { loadMiraVoiceContext } from '@/lib/miraVoiceContext'
import { sanitizeMiraPreferences } from '@/lib/miraVoices'
import { MIRA_CHAT_STORE_OPTIONS, readMiraTokens } from '@/lib/miraChatStore.server'
import { rateLimit } from '@/lib/security/rateLimiter'

export const dynamic = 'force-dynamic'
export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, MIRA_CHAT_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    const userId = String(auth.user._id)
    if (!(await rateLimit('MIRA_AGENT_SESSION', `${auth.tenant.databaseName}:${userId}`)).allowed) return NextResponse.json({ message: 'Please wait before restarting voice.' }, { status: 429 })
    if (!process.env.DEEPSEEK_API_KEY || !process.env.ELEVENLABS_API_KEY) return NextResponse.json({ message: 'Mira voice is not configured.' }, { status: 503 })
    const balance = await readMiraTokens(auth.database, userId)
    if (!balance.tokensRemaining) return NextResponse.json({ message: 'Your monthly Mira allowance is exhausted.' }, { status: 429 })
    const profile = await auth.database.get('users', userId)
    const preferences = sanitizeMiraPreferences(profile?.miraPreferences)
    const context = await loadMiraVoiceContext(auth.database, auth.user, profile, auth.tenant)
    // Cache only basic profile context in a short-lived signed session. Every
    // reply still rechecks live authorization and quota, including revocations.
    return NextResponse.json({ success: true, voiceId: preferences.voiceId,
      language: ['en', 'hi'].includes(auth.user.miraLanguage) ? auth.user.miraLanguage : 'en',
      bridgeCredential: await createMiraBridgeCredential(auth.user, auth.tenant, context),
      renewAfterMs: 9 * 60 * 1000, ...balance,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ message: 'Could not start Mira voice.' }, { status: 502 }) }
}
