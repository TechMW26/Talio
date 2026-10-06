import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { ONBOARDING_STORE_OPTIONS, listOnboardingEmails } from '@/lib/onboardingEmails.server'
export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, ONBOARDING_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    if (!['admin', 'hr'].includes(auth.user.role)) return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    return NextResponse.json({ success: true, ...await listOnboardingEmails(auth.database, new URL(request.url).searchParams) })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Failed to fetch onboarding emails' }, { status: error.status || 500 }) }
}
export async function PATCH(request) {
  try {
    const auth = await getAuthAndDatabase(request, ONBOARDING_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    if (auth.user.role !== 'admin') return NextResponse.json({ success: false, message: 'Only admin can change this setting' }, { status: 403 })
    const { enabled } = await request.json()
    if (typeof enabled !== 'boolean') return NextResponse.json({ success: false, message: 'enabled must be a boolean' }, { status: 400 })
    const existing = (await auth.database.list('companysettings', { limit: 1 })).records[0]
    const id = existing?._id || '000000000000000000000001'
    await auth.database.transaction(async tx => {
      const current = await tx.get('companysettings', id)
      const next = { ...current, _id: id, notifications: { ...current?.notifications, onboardingEmailsEnabled: enabled }, updatedAt: new Date() }
      if (current) await tx.replace('companysettings', next)
      else await tx.create('companysettings', { ...next, createdAt: new Date() })
    })
    return NextResponse.json({ success: true, message: 'Onboarding email setting updated', onboardingEmailsEnabled: enabled })
  } catch (error) { return NextResponse.json({ success: false, message: 'Failed to update setting' }, { status: 500 }) }
}
