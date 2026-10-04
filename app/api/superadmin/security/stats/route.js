import { NextResponse } from 'next/server'
import { verifySuperAdmin } from '@/lib/superadminAuth'
import { getSuperadminStore, readReportPages } from '@/lib/platform/firestoreSuperadmin.server'
export const dynamic = 'force-dynamic'
export async function GET(request) {
  const auth = await verifySuperAdmin(request)
  if (!auth.success) return NextResponse.json({ message: auth.message }, { status: 401 })
  try {
    const database = await getSuperadminStore()
    const since24 = new Date(Date.now() - 86400000)
    const [events, failed7, permanentBlocks, temporaryBlocks] = await Promise.all([
      readReportPages(database, 'securityevents', { filters: [{ field: 'createdAt', operator: '>=', value: since24 }] }),
      database.count('securityevents', [{ field: 'type', operator: '==', value: 'auth.login.failed' }, { field: 'createdAt', operator: '>=', value: new Date(Date.now() - 7 * 86400000) }]),
      database.count('ipblocks', [{ field: 'expiresAt', operator: '==', value: null }]),
      database.count('ipblocks', [{ field: 'expiresAt', operator: '>', value: new Date() }]),
    ])
    const types = new Map(), ips = new Map(), emails = new Map()
    for (const event of events) {
      types.set(event.type, (types.get(event.type) || 0) + 1)
      if (event.ip && ['auth.login.failed', 'rate_limit.hit', 'input.suspicious', 'permission.denied'].includes(event.type)) {
        const row = ips.get(event.ip) || { ip: event.ip, count: 0, types: new Set() }
        row.count++; row.types.add(event.type); ips.set(event.ip, row)
      }
      if (event.email && ['auth.login.failed', 'auth.login.locked'].includes(event.type)) emails.set(event.email, (emails.get(event.email) || 0) + 1)
    }
    return NextResponse.json({ success: true, generatedAt: new Date().toISOString(), stats: {
      failedLogins24h: types.get('auth.login.failed') || 0, failedLogins7d: failed7,
      successfulLogins24h: types.get('auth.login.success') || 0, rateLimitHits24h: types.get('rate_limit.hit') || 0,
      suspiciousInputs24h: types.get('input.suspicious') || 0, lockouts24h: types.get('auth.login.locked') || 0,
      totalEvents24h: events.length, activeBlocks: permanentBlocks + temporaryBlocks,
    }, topOffendingIps: [...ips.values()].sort((a, b) => b.count - a.count).slice(0, 10).map(row => ({ ...row, types: [...row.types] })),
      topTargetedAccounts: [...emails].map(([email, count]) => ({ email, count })).sort((a, b) => b.count - a.count).slice(0, 10),
      eventsByType: [...types].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    })
  } catch (error) { return NextResponse.json({ message: 'Failed to load security stats' }, { status: 500 }) }
}
