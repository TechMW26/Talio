import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { getAuthAndModels } from '@/lib/auth'
import { createMachineToken, hashMachineToken } from '@/lib/attendanceMachines/machineSecurity.server'
import { WP_ROLES, normalizeSiteUrl, syncError } from '@/lib/recruitment/wordpress.server'

export const dynamic = 'force-dynamic'
async function authorize(request) {
  const auth = await getAuthAndModels(request, ['WordPressRecruitmentIntegration', 'Department'])
  if (!auth.success) throw syncError('Please sign in', 401)
  if (!WP_ROLES.includes(auth.user.role)) throw syncError('Only HR and administrators can manage this integration', 403)
  return auth
}
function publicSettings(integration, auth) {
  return { configured: Boolean(integration), enabled: Boolean(integration?.enabled), siteUrl: integration?.siteUrl || '', defaultDepartment: String(integration?.defaultDepartment || ''), lastSeenAt: integration?.lastSeenAt || null, lastSyncAt: integration?.lastSyncAt || null, lastError: integration?.lastError || '', endpointPath: `/api/integrations/wordpress/${encodeURIComponent(auth.tenant.companySlug)}` }
}
function errorResponse(error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'WordPress connection could not be updated' }, { status: error.status || 500 }) }
export async function GET(request) {
  try { const auth = await authorize(request); const integration = await auth.models.WordPressRecruitmentIntegration.findById('wordpress').lean(); return NextResponse.json({ success: true, data: publicSettings(integration, auth) }, { headers: { 'Cache-Control': 'private, no-store' } }) }
  catch (error) { return errorResponse(error) }
}
export async function POST(request) {
  try {
    const auth = await authorize(request), input = await request.json(), Model = auth.models.WordPressRecruitmentIntegration
    if (!auth.tenant.companySlug) throw syncError('This organisation needs a tenant slug before connecting WordPress')
    const current = await Model.findById('wordpress').lean()
    if (input.action === 'disable') {
      await Model.updateOne({ _id: 'wordpress' }, { $set: { enabled: false } })
      return NextResponse.json({ success: true, data: publicSettings(current && { ...current, enabled: false }, auth) })
    }
    if (input.action !== 'connect') throw syncError('Invalid connection action')
    const siteUrl = normalizeSiteUrl(input.siteUrl)
    if (current && current.siteUrl !== siteUrl) throw syncError('This organisation is already paired with a different site. Contact support before changing its identity.', 409)
    if (!mongoose.Types.ObjectId.isValid(input.defaultDepartment || '') || !await auth.models.Department.exists({ _id: input.defaultDepartment })) throw syncError('Select a default department for website jobs')
    const token = createMachineToken()
    const integration = await Model.findByIdAndUpdate('wordpress', { $set: { siteUrl, defaultDepartment: input.defaultDepartment, enabled: true, tokenHash: hashMachineToken(token), lastError: '' }, $setOnInsert: { connectionId: randomUUID(), createdBy: auth.user._id } }, { new: true, upsert: true, runValidators: true }).lean()
    return NextResponse.json({ success: true, data: { ...publicSettings(integration, auth), token } }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return errorResponse(error) }
}
