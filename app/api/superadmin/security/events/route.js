import { NextResponse } from 'next/server'
import { verifySuperAdmin } from '@/lib/superadminAuth'
import { getSuperadminStore, readAdminPage } from '@/lib/platform/firestoreSuperadmin.server'
export const dynamic = 'force-dynamic'
export async function GET(request) {
  const auth = await verifySuperAdmin(request)
  if (!auth.success) return NextResponse.json({ message: auth.message || 'Unauthorized' }, { status: 401 })
  try {
    const { searchParams: query } = new URL(request.url)
    const filters = []
    let disjunctions = 1
    for (const name of ['type', 'severity']) {
      if (!query.get(name)) continue
      const values = [...new Set(query.get(name).split(',').map(value => value.trim()).filter(Boolean))]
      if (!values.length || values.length > 10) return NextResponse.json({ message: 'Invalid filter' }, { status: 400 })
      disjunctions *= values.length
      if (disjunctions > 30) return NextResponse.json({ message: 'Combined filters exceed 30 combinations; narrow the event types or severities' }, { status: 400 })
      filters.push({ field: name, operator: values.length === 1 ? '==' : 'in', value: values.length === 1 ? values[0] : values })
    }
    for (const name of ['ip', 'email', 'userId']) if (query.get(name)) filters.push({ field: name, operator: '==', value: name === 'email' ? query.get(name).trim().toLowerCase() : query.get(name) })
    const since = query.get('since') ? new Date(query.get('since')) : new Date(Date.now() - 86400000)
    const until = query.get('until') ? new Date(query.get('until')) : null
    if (!Number.isFinite(since.getTime()) || (until && (!Number.isFinite(until.getTime()) || until < since))) return NextResponse.json({ message: 'Invalid date range' }, { status: 400 })
    filters.push({ field: 'createdAt', operator: '>=', value: since })
    if (until) filters.push({ field: 'createdAt', operator: '<=', value: until })
    if (disjunctions * (filters.length + 3) > 100) return NextResponse.json({ message: 'Combined filters are too broad; narrow the event types or severities' }, { status: 400 })
    const limit = Math.min(Math.max(Number(query.get('limit')) || 50, 1), 500)
    const skip = Math.max(Number(query.get('skip')) || 0, 0)
    const database = await getSuperadminStore()
    const [page, total] = await Promise.all([
      readAdminPage(database, 'securityevents', { filters, orderBy: [{ field: 'createdAt', direction: 'desc' }], limit, skip, cursor: query.get('cursor') }),
      database.count('securityevents', filters),
    ])
    return NextResponse.json({ success: true, events: page.records, total, limit, skip, nextCursor: page.nextCursor })
  } catch (error) { return NextResponse.json({ message: error.status ? error.message : 'Failed to load security events' }, { status: error.status || 500 }) }
}
