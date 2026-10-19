import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createHabitReceipt, verifyHabitReceipt } from '@/lib/miraDesktopHabitReceipt.server'
import { getAuthAndDatabase } from '@/lib/auth'
import { rateLimit } from '@/lib/security/rateLimiter'
import { cleanDesktopHabits, recordDesktopHabit, personalizeDesktopGoal } from '@/lib/miraDesktopHabits'

export const runtime = 'nodejs'
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
const scope = auth => createHash('sha256').update(JSON.stringify([auth.tenant.databaseName, String(auth.user._id)])).digest('hex')
export async function POST(request) {
  const auth = await getAuthAndDatabase(request)
  if (!auth.success) return reply({ success: false }, auth.status || 401)
  const limit = await rateLimit('MIRA_COMPUTER', `habits:${scope(auth)}`)
  if (!limit.allowed) return reply({ success: false }, 429)
  try {
    const reader = request.body?.getReader()
    if (!reader) return reply({ success: false }, 400)
    const chunks = []; let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 14000) { await reader.cancel(); return reply({ success: false }, 413) }
      chunks.push(Buffer.from(value))
    }
    const raw = Buffer.concat(chunks).toString('utf8')
    const body = JSON.parse(raw)
    if (body.operation === 'prepare' && typeof body.goal === 'string' && body.goal.trim() && body.goal.length <= 3000) {
      const profile = await auth.database.get('users', auth.user._id)
      const goal = personalizeDesktopGoal(body.goal, profile?.miraDesktopHabits)
      // Bind completion to this account and ORIGINAL request, not inferred defaults.
      const ticket = createHabitReceipt(scope(auth), body.goal, cleanDesktopHabits(profile?.miraDesktopHabits).generation)
      return reply({ success: true, goal, ticket })
    }
    if (body.operation === 'complete' && typeof body.ticket === 'string' && body.ticket.length < 10000) {
      const payload = verifyHabitReceipt(body.ticket, scope(auth))
      await auth.database.mutate('users', auth.user._id, fresh => cleanDesktopHabits(fresh.miraDesktopHabits).generation !== payload.generation ? fresh : ({ ...fresh,
        miraDesktopHabits: recordDesktopHabit(fresh.miraDesktopHabits, payload.goal, payload.id) }))
      return reply({ success: true })
    }
    if (body.operation === 'clear' || body.operation === 'enabled' && typeof body.enabled === 'boolean') {
      await auth.database.mutate('users', auth.user._id, fresh => {
        const previous = cleanDesktopHabits(fresh.miraDesktopHabits), generation = previous.generation + 1
        return { ...fresh, miraDesktopHabits: body.operation === 'clear'
          ? { enabled: previous.enabled, generation, music: [], receipts: [] }
          : { ...previous, generation, enabled: body.enabled } }
      })
      return reply({ success: true })
    }
    return reply({ success: false }, 400)
  } catch { return reply({ success: false, message: 'Desktop preferences are unavailable.' }, 400) }
}
export async function GET(request) {
  const auth = await getAuthAndDatabase(request)
  if (!auth.success) return reply({ success: false }, auth.status || 401)
  const profile = await auth.database.get('users', auth.user._id)
  const { receipts, ...data } = cleanDesktopHabits(profile?.miraDesktopHabits)
  return reply({ success: true, data })
}
