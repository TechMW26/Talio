import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { MIRA_VOICES, sanitizeMiraPreferences } from '@/lib/miraVoices'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const auth = await getAuthAndModels(request, ['User'])
  if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
  const { User } = auth.models
  const user = await User.findById(auth.user._id).select('miraPreferences').lean()
  return NextResponse.json({ success: true, data: sanitizeMiraPreferences(user?.miraPreferences), voices: MIRA_VOICES })
}

export async function PUT(request) {
  const auth = await getAuthAndModels(request, ['User'])
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
  const current = await auth.models.User.findById(auth.user._id).select('miraPreferences')
  if (!current) return NextResponse.json({ success: false, message: 'User profile not found.' }, { status: 404 })
  const existing = current.miraPreferences?.toObject?.() || current.miraPreferences || {}
  const next = { ...existing, ...sanitizeMiraPreferences(existing) }
  for (const field of ['voiceId', 'customInstructions', 'knowledge']) {
    if (body[field] !== undefined) next[field] = body[field]
  }
  current.miraPreferences = next
  await current.save()
  return NextResponse.json({ success: true, data: sanitizeMiraPreferences(current.miraPreferences), message: 'MIRA preferences saved.' })
}
