import { NextResponse } from 'next/server'
import { getAuthAndDatabase, hasRole } from '@/lib/auth'
import { readAdminPage } from '@/lib/platform/firestoreSuperadmin.server'
export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, { queryFields: { rbacauditlogs: ['createdAt', 'eventType'] } })
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    if (!hasRole(auth.user, ['admin', 'super_admin'])) return NextResponse.json({ success: false, message: 'Only admins can view audit logs' }, { status: 403 })
    const query = new URL(request.url).searchParams, page = Math.max(1, parseInt(query.get('page')) || 1), limit = Math.min(100, Math.max(1, parseInt(query.get('limit')) || 50))
    const filters = query.get('eventType') ? [{ field: 'eventType', operator: '==', value: query.get('eventType') }] : []
    const [result, total] = await Promise.all([
      readAdminPage(auth.database, 'rbacauditlogs', { filters, orderBy: [{ field: 'createdAt', direction: 'desc' }], skip: (page - 1) * limit, limit, cursor: query.get('cursor') }),
      auth.database.count('rbacauditlogs', filters),
    ])
    const ids = [...new Set(result.records.map(row => row.actorId).filter(Boolean).map(String))]
    const actors = await auth.database.getMany('users', ids)
    const emails = new Map(actors.filter(Boolean).map(user => [String(user._id), user.email]))
    return NextResponse.json({ success: true, data: result.records.map(log => ({ ...log, actorEmail: log.actorId ? emails.get(String(log.actorId)) || 'Unknown' : 'System' })), pagination: { page, limit, total, totalPages: Math.ceil(total / limit), nextCursor: result.nextCursor } })
  } catch (error) { return NextResponse.json({ success: false, message: 'Failed to fetch audit logs' }, { status: error.status || 500 }) }
}
