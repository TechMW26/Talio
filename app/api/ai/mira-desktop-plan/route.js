import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { rateLimit, buildRateLimitHeaders } from '@/lib/security/rateLimiter'
import { requestHybridDesktop, validateHybridRequest } from '@/lib/ai/miraHybridDesktop'

export const runtime = 'nodejs'
export const maxDuration = 15
const reply = (body, status = 200, headers = {}) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
export async function POST(request) {
  const auth = await getAuthAndDatabase(request)
  if (!auth.success) return reply({ success: false }, auth.status || 401)
  const identity = `${auth.tenant.databaseName}:${auth.user._id}`
  const limit = await rateLimit('MIRA_DESKTOP_DECISION', identity)
  if (!limit.allowed) return reply({ success: false, fallback: true }, 429, buildRateLimitHeaders(limit))
  let body
  try {
    const reader = request.body?.getReader()
    if (!reader) throw new Error('Missing body')
    const chunks = []; let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 48000) { await reader.cancel(); return reply({ success: false }, 413) }
      chunks.push(Buffer.from(value))
    }
    body = validateHybridRequest(JSON.parse(Buffer.concat(chunks).toString()))
  } catch { return reply({ success: false }, 400) }
  try { return reply(await requestHybridDesktop(body, identity, request.signal)) }
  catch { return reply({ success: true, fallback: true, reason: 'planner_unavailable' }) }
}
