import { NextResponse } from 'next/server'
import { getFirestoreSystemDatabase } from '@/lib/platform/firestoreApplication.server'
import { startMiraLink, pollMiraLink } from '@/lib/miraAccountLink.server'
import { rateLimit } from '@/lib/security/rateLimiter'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'no-store' }
export async function POST(request) {
  try {
    const ip = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown'
    const limited = await rateLimit('MIRA_LINK_DEVICE', ip)
    if (!limited.allowed) return NextResponse.json({ error: 'slow_down', interval: 10 }, { status: 429, headers })
    if (Number(request.headers.get('content-length')) > 4096) return NextResponse.json({ error: 'invalid_request' }, { status: 413, headers })
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers })
    if (JSON.stringify(body).length > 4096) return NextResponse.json({ error: 'invalid_request' }, { status: 413, headers })
    const system = await getFirestoreSystemDatabase()
    if (body.operation === 'start') {
      const startLimit = await rateLimit('MIRA_AGENT_SESSION', 'link-start:' + ip)
      if (!startLimit.allowed) return NextResponse.json({ error: 'slow_down', interval: 60 }, { status: 429, headers })
      const data = await startMiraLink(system, body)
      // No caller-controlled redirect, host, client label or tenant selection.
      const verification_uri = 'https://app.talio.in/dashboard/mira/connect'
      return NextResponse.json({ ...data, verification_uri, verification_uri_complete: verification_uri + '?user_code=' + data.user_code }, { headers })
    }
    if (body.operation !== 'poll') return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers })
    const data = await pollMiraLink(system, body)
    return NextResponse.json(data, { status: data.error ? 400 : 200, headers })
  } catch (error) {
    return NextResponse.json({ error: error.code || 'link_unavailable' }, { status: error.status || 503, headers })
  }
}
