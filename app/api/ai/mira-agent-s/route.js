import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { rateLimit } from '@/lib/security/rateLimiter'
import { requestAgentSModel, validateAgentSMessages } from '@/lib/ai/agentSProxy'

export const runtime = 'nodejs'
export const maxDuration = 60
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
export async function POST(request) {
  const auth = await getAuthAndModels(request, ['User'])
  if (!auth.success) return reply({ success: false }, 401)
  const limit = await rateLimit('MIRA_COMPUTER', `${auth.tenant.databaseName}:${auth.user._id}`)
  if (!limit.allowed) return reply({ success: false, message: 'Desktop vision is busy. Please try again shortly.' }, 429)
  let body
  try {
    const reader = request.body?.getReader()
    if (!reader) return reply({ success: false }, 400)
    const chunks = []; let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 4 * 1024 * 1024) { await reader.cancel(); return reply({ success: false }, 413) }
      chunks.push(Buffer.from(value))
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    validateAgentSMessages(body.messages)
  } catch { return reply({ success: false, message: 'Invalid desktop model request.' }, 400) }
  try {
    return reply({ success: true, text: await requestAgentSModel(body.messages, { signal: request.signal }) })
  } catch { return reply({ success: false, message: 'Desktop vision could not respond. No new input was sent.' }, 502) }
}
