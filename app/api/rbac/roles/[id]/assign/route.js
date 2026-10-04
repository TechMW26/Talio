import { NextResponse } from 'next/server'
import { getAuthAndDatabase, hasRole } from '@/lib/auth'
import { ROLE_STORE_OPTIONS, getNativeRole, assignNativeRole } from '@/lib/platform/firestoreRoles.server'
import { refreshAffectedUsers } from '@/lib/rbacSessionRefresh'
import { logRBACEvent, extractRequestMeta } from '@/lib/rbacAudit'
export async function PUT(request, { params }) {
  try {
    const { id } = await params
    const auth = await getAuthAndDatabase(request, ROLE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    if (!hasRole(auth.user, ['admin', 'super_admin'])) return NextResponse.json({ success: false, message: 'Only admins can assign roles' }, { status: 403 })
    const role = await getNativeRole(auth.database, id)
    if (!role) return NextResponse.json({ success: false, message: 'Role not found' }, { status: 404 })
    const { userIds } = await request.json()
    const assigned = await assignNativeRole(auth.database, id, userIds)
    await refreshAffectedUsers({ databaseName: auth.tenant.databaseName, database: auth.database, userIds: assigned, initiatedBy: { userId: auth.user._id, email: auth.user.email, role: auth.user.role }, message: 'Your access role was updated. Talio is applying the new permissions.' })
    await logRBACEvent(auth.tenant.databaseName, { eventType: 'user_role_changed', actorId: auth.user._id, targetId: role._id, targetType: 'Role', metadata: { roleName: role.name, assignedUserIds: assigned, modifiedCount: assigned.length }, ...extractRequestMeta(request) })
    return NextResponse.json({ success: true, message: 'Role assigned to ' + assigned.length + ' user(s)', data: { modifiedCount: assigned.length } })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Failed to assign role' }, { status: error.status || 500 }) }
}
