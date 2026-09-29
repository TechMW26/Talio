import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { INDUCTION_MODELS, canManageInduction, inductionError, inductionSettings, inductionScope, publishInduction } from '@/lib/hrms/induction.server'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, INDUCTION_MODELS)
    if (!auth.success) throw inductionError('Sign in to continue', 401)
    return NextResponse.json({ success: true, data: await inductionSettings(auth, new URL(request.url).searchParams.get('companyId')) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to load orientation settings' }, { status: error.status || 500 }) }
}
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, INDUCTION_MODELS)
    if (!auth.success || !canManageInduction(auth.user)) throw inductionError('Only HR and administrators can publish induction content', 403)
    const input = await request.json()
    const scope = await inductionScope(auth, input.companyId)
    if (input.action === 'withdraw') {
      const changed = await auth.models.InductionProgram.updateOne({ _id: scope, version: input.previousVersion }, { $set: { active: false } })
      if (!changed.matchedCount) throw inductionError('The presentation changed. Reload Settings.', 409)
    } else if (input.action === 'publish') await publishInduction(auth, input)
    else throw inductionError('Invalid induction action')
    return NextResponse.json({ success: true, data: await inductionSettings(auth, input.companyId) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to publish. Check that the file is a valid, unencrypted PDF or PPTX.' }, { status: error.status || 400 }) }
}
