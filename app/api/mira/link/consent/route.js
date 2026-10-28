import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getFirestoreSystemDatabase } from '@/lib/platform/firestoreApplication.server'
import { LINK_GRANTS, LINK_STORE_OPTIONS, inspectMiraLink, approveMiraLink, revokeMiraLink } from '@/lib/miraAccountLink.server'
import { rateLimit } from '@/lib/security/rateLimiter'

const headers = { 'Cache-Control': 'private, no-store' }
async function handle(request, method) {
  try {
    if (method !== 'GET' && request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ error: 'Cross-origin approval is not allowed.' }, { status: 403, headers })
    // Existing fresh account, tenant, plan and Mira designation gates apply.
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ error: auth.message }, { status: auth.status || 401, headers })
    const limited = await rateLimit('AUTH_LOGIN', 'mira-link:' + auth.tenant.databaseName + ':' + auth.user._id)
    if (!limited.allowed) return NextResponse.json({ error: 'Too many linking attempts. Please wait.' }, { status: 429, headers })
    const system = await getFirestoreSystemDatabase(LINK_STORE_OPTIONS)
    if (method === 'GET') {
      const userCode = new URL(request.url).searchParams.get('user_code')
      const grants = (await system.list(LINK_GRANTS, { filters: [
        { field: 'owner', operator: '==', value: String(auth.user._id) },
        { field: 'tenant', operator: '==', value: auth.tenant.databaseName },
      ], limit: 50 })).records.filter(row => !row.revoked && row.expiresAt > Date.now())
      return NextResponse.json({ account: { name: auth.user.name || auth.user.email, company: auth.tenant.companyName },
        ...(userCode ? { request: await inspectMiraLink(system, userCode) } : {}),
        grants: grants.map(row => ({ id: row._id, scopes: row.scopes, createdAt: row.createdAt, expiresAt: row.expiresAt })),
      }, { headers })
    }
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid approval request.' }, { status: 400, headers })
    if (method === 'DELETE') {
      if (!/^[a-f0-9]{24}$/.test(body.id || '')) return NextResponse.json({ error: 'Invalid connection.' }, { status: 400, headers })
      const grant = await system.get(LINK_GRANTS, body.id)
      if (!grant || grant.owner !== String(auth.user._id) || grant.tenant !== auth.tenant.databaseName) return NextResponse.json({ error: 'Connection not found.' }, { status: 404, headers })
      await revokeMiraLink(system, grant)
      return NextResponse.json({ revoked: true }, { headers })
    }
    return NextResponse.json(await approveMiraLink(system, auth, body), { headers })
  } catch (error) { return NextResponse.json({ error: error.code || 'Link approval is temporarily unavailable.' }, { status: error.status || 503, headers }) }
}
export const GET = request => handle(request, 'GET')
export const POST = request => handle(request, 'POST')
export const DELETE = request => handle(request, 'DELETE')
