import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { verifyTokenFromRequest } from '@/lib/auth'
import { createMachineToken, hashMachineToken } from '@/lib/attendanceMachines/machineSecurity.server'
import { WP_ROLES, WORDPRESS_COLLECTION, getWordpressStore, normalizeSiteUrl, syncError } from '@/lib/recruitment/wordpress.server'

export const dynamic = 'force-dynamic'
async function authorize(request) {
  const auth = await verifyTokenFromRequest(request)
  if (!auth.success) throw syncError('Please sign in', 401)
  if (!WP_ROLES.includes(auth.user.role)) throw syncError('Only HR and administrators can manage this integration', 403)
  return auth
}
function publicSettings(integration, auth) {
  return { configured: Boolean(integration), enabled: Boolean(integration?.enabled), siteUrl: integration?.siteUrl || '', defaultDepartment: String(integration?.defaultDepartment || ''), lastSeenAt: integration?.lastSeenAt || null, lastSyncAt: integration?.lastSyncAt || null, lastError: integration?.lastError || '', endpointPath: `/api/integrations/wordpress/${encodeURIComponent(auth.tenant.companySlug)}` }
}
function errorResponse(error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'WordPress connection could not be updated' }, { status: error.status || 500 }) }
export async function GET(request) {
  try { const auth = await authorize(request); const integration = await (await getWordpressStore(auth.tenant.databaseName)).get(WORDPRESS_COLLECTION, 'wordpress'); return NextResponse.json({ success: true, data: publicSettings(integration, auth) }, { headers: { 'Cache-Control': 'private, no-store' } }) }
  catch (error) { return errorResponse(error) }
}
export async function POST(request) {
  try {
    const auth = await authorize(request), input = await request.json(), store = await getWordpressStore(auth.tenant.databaseName)
    if (!auth.tenant.companySlug) throw syncError('This organisation needs a tenant slug before connecting WordPress')
    const current = await store.get(WORDPRESS_COLLECTION, 'wordpress')
    if (input.action === 'disable') {
      await store.mutate(WORDPRESS_COLLECTION, 'wordpress', value => ({ ...value, enabled: false, updatedAt: new Date() }))
      return NextResponse.json({ success: true, data: publicSettings(current && { ...current, enabled: false }, auth) })
    }
    if (input.action !== 'connect') throw syncError('Invalid connection action')
    const siteUrl = normalizeSiteUrl(input.siteUrl)
    if (current && current.siteUrl !== siteUrl) throw syncError('This organisation is already paired with a different site. Contact support before changing its identity.', 409)
    if (!/^[a-f0-9]{24}$/i.test(input.defaultDepartment || '') || !await store.get('departments', input.defaultDepartment)) throw syncError('Select a default department for website jobs')
    const token = createMachineToken()
    const newConnectionId = randomUUID()
    const integration = await store.transaction(async tx => {
      const previous = await tx.get(WORDPRESS_COLLECTION, 'wordpress')
      if (previous && previous.siteUrl !== siteUrl) throw syncError('This organisation is already paired with a different site.', 409)
      const next = { _id: 'wordpress', connectionId: newConnectionId, createdBy: String(auth.user._id), createdAt: new Date(), ...previous, siteUrl, defaultDepartment: input.defaultDepartment, enabled: true, tokenHash: hashMachineToken(token), lastError: '', updatedAt: new Date() }
      if (previous) await tx.replace(WORDPRESS_COLLECTION, next)
      else await tx.create(WORDPRESS_COLLECTION, next)
      return next
    })
    return NextResponse.json({ success: true, data: { ...publicSettings(integration, auth), token } }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return errorResponse(error) }
}
