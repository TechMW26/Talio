import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { rateLimit } from '@/lib/security/rateLimiter'

export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request)
    if (!auth.success) return NextResponse.json({ message: 'Authentication required' }, { status: auth.status || 401 })
    const bucket = await rateLimit('MIRA_VOICE', `${auth.tenant.databaseName}:${auth.user._id}:recognition`)
    if (!bucket.allowed) return NextResponse.json({ message: 'Please wait before restarting voice.' }, { status: 429 })
    if (!process.env.ELEVENLABS_API_KEY) return NextResponse.json({ message: 'Multilingual voice is not configured.' }, { status: 503 })
    const response = await fetch('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', {
      method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
    })
    if (!response.ok) throw new Error('Token service unavailable')
    const { token } = await response.json()
    if (typeof token !== 'string') throw new Error('Missing token')
    return NextResponse.json({ token }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ message: 'Unable to start multilingual voice. Please try again.' }, { status: 502 }) }
}
