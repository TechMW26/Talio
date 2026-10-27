import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { MIRA_VOICES, sanitizeMiraPreferences } from '@/lib/miraVoices'
import { sanitizeMiraProactive } from '@/lib/miraProactive'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const auth = await getAuthAndDatabase(request)
  if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
  const user = await auth.database.get('users', auth.user._id)
  return NextResponse.json({ success: true, data: sanitizeMiraPreferences(user?.miraPreferences), voices: MIRA_VOICES })
}

export async function PUT(request) {
  const auth = await getAuthAndDatabase(request)
  if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ success: false, message: 'Invalid MIRA preferences.' }, { status: 400 })
  if (body.voiceId !== undefined && (typeof body.voiceId !== 'string' || !MIRA_VOICES.some(voice => voice.id === body.voiceId))) {
    return NextResponse.json({ success: false, message: 'Choose a voice from the available MIRA voices.' }, { status: 400 })
  }
  for (const [field, max] of [['customInstructions', 1600], ['knowledge', 8000]]) {
    if (body[field] !== undefined && (typeof body[field] !== 'string' || body[field].length > max)) {
      return NextResponse.json({ success: false, message: `${field} must be text under ${max} characters.` }, { status: 400 })
    }
  }
  if (body.proactive !== undefined) {
    if (!body.proactive || typeof body.proactive !== 'object' || Array.isArray(body.proactive)) return NextResponse.json({ success: false, message: 'Invalid proactive preferences.' }, { status: 400 })
    for (const key of ['enabled', 'meetings', 'tasks', 'messages', 'email', 'quietHoursEnabled']) if (body.proactive[key] !== undefined && typeof body.proactive[key] !== 'boolean') return NextResponse.json({ success: false, message: 'Proactive switches must be on or off.' }, { status: 400 })
    for (const key of ['quietStart', 'quietEnd']) if (body.proactive[key] !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.proactive[key])) return NextResponse.json({ success: false, message: 'Choose a valid quiet-hours time.' }, { status: 400 })
    if (body.proactive.timezone !== undefined) { try { if (typeof body.proactive.timezone !== 'string' || body.proactive.timezone.length > 80) throw new Error(); new Intl.DateTimeFormat('en', { timeZone: body.proactive.timezone }).format() } catch { return NextResponse.json({ success: false, message: 'Choose a valid timezone.' }, { status: 400 }) } }
  }
  const current = await auth.database.get('users', auth.user._id)
  if (!current) return NextResponse.json({ success: false, message: 'User profile not found.' }, { status: 404 })
  const saved = await auth.database.mutate('users', current._id, fresh => {
    const existing = fresh.miraPreferences || {}
    const next = { ...existing, ...sanitizeMiraPreferences(existing) }
    for (const field of ['voiceId', 'customInstructions', 'knowledge']) if (body[field] !== undefined) next[field] = body[field]
    if (body.proactive !== undefined) next.proactive = sanitizeMiraProactive({ ...existing.proactive, ...body.proactive })
    return { ...fresh, miraPreferences: next, updatedAt: new Date() }
  })
  return NextResponse.json({ success: true, data: sanitizeMiraPreferences(saved.miraPreferences), message: 'MIRA preferences saved.' })
}
