import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'

export const runtime = 'nodejs'

// Compatibility for already-open clients from 6.0.29–31: immediately fall back
// to their existing screenshot/Agent S flow. Never call a decision provider.
export async function POST(request) {
  const auth = await getAuthAndDatabase(request)
  return NextResponse.json(auth.success
    ? { success: true, fallback: true, reason: 'visual_control_restored' }
    : { success: false }, {
    status: auth.success ? 200 : auth.status || 401,
    headers: { 'Cache-Control': 'no-store' },
  })
}
