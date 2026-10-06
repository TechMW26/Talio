import { NextResponse } from 'next/server'
import { getAuthAndDatabase, hasRole } from '@/lib/auth'
import { ROLE_STORE_OPTIONS, getNativeRole, updateNativeRole, nativeRoleUsers, deleteNativeRole } from '@/lib/platform/firestoreRoles.server'
import { invalidatePermissionsCache } from '@/lib/permissions'
import { refreshAffectedUsers } from '@/lib/rbacSessionRefresh'
import { logRBACEvent, extractRequestMeta } from '@/lib/rbacAudit'

async function handler(request, params, method) {
  try {
    const { id } = await params
    const auth = await getAuthAndDatabase(request, ROLE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    if (!hasRole(auth.user, ['admin', 'super_admin'])) return NextResponse.json({ success: false, message: 'Only admins can manage roles' }, { status: 403 })
    const { database, user, tenant } = auth
    const before = await getNativeRole(database, id)
    if (!before) return NextResponse.json({ success: false, message: 'Role not found' }, { status: 404 })
    if (method === 'GET') return NextResponse.json({ success: true, data: before })
    let role, userIds
    if (method === 'PUT') {
      role = await updateNativeRole(database, id, await request.json())
      userIds = (await nativeRoleUsers(database, id)).filter(user => user.isActive).map(user => String(user._id))
      await invalidatePermissionsCache(tenant.databaseName, userIds)
    } else {
      const result = await deleteNativeRole(database, id)
      role = result.role; userIds = result.userIds
    }
    await refreshAffectedUsers({ databaseName: tenant.databaseName, database, userIds, initiatedBy: { userId: user._id, email: user.email, role: user.role },
      message: method === 'PUT' ? 'Your role permissions were updated. Talio is applying the latest access.' : 'Your custom role was removed. Talio is applying the default access.',
    })
    await logRBACEvent(tenant.databaseName, { eventType: method === 'PUT' ? 'role_updated' : 'role_deleted', actorId: user._id, targetId: role._id, targetType: 'Role', metadata: { roleName: role.name, displayLabel: role.displayLabel, affectedUserCount: userIds.length }, ...extractRequestMeta(request) })
    return NextResponse.json({ success: true, message: method === 'PUT' ? 'Role updated successfully' : 'Role deleted. Assigned users reverted to default permissions.', ...(method === 'PUT' ? { data: role } : {}) })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Role operation failed' }, { status: error.status || 500 }) }
}
export const GET = (request, { params }) => handler(request, params, 'GET')
export const PUT = (request, { params }) => handler(request, params, 'PUT')
export const DELETE = (request, { params }) => handler(request, params, 'DELETE')
