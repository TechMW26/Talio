import { NextResponse } from 'next/server'
import { getAuthAndDatabase, hasRole } from '@/lib/auth'
import { ROLE_STORE_OPTIONS, listNativeRoles, createNativeRole } from '@/lib/platform/firestoreRoles.server'
import { logRBACEvent, extractRequestMeta } from '@/lib/rbacAudit'

export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, ROLE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    if (!hasRole(auth.user, ['admin', 'super_admin'])) return NextResponse.json({ success: false, message: 'Only admins can view roles' }, { status: 403 })
    return NextResponse.json({ success: true, data: await listNativeRoles(auth.database, true) })
  } catch (error) { return NextResponse.json({ success: false, message: 'Failed to fetch roles' }, { status: error.status || 500 }) }
}

export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, ROLE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    if (!hasRole(auth.user, ['admin', 'super_admin'])) return NextResponse.json({ success: false, message: 'Only admins can create roles' }, { status: 403 })
    const role = await createNativeRole(auth.database, auth.user, await request.json())
    await logRBACEvent(auth.tenant.databaseName, { eventType: 'role_created', actorId: auth.user._id, targetId: role._id, targetType: 'Role', metadata: { name: role.name, displayLabel: role.displayLabel }, ...extractRequestMeta(request) })
    return NextResponse.json({ success: true, message: 'Role created successfully', data: role }, { status: 201 })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Failed to create role' }, { status: error.status || (error.code === 'ALREADY_EXISTS' ? 409 : 500) }) }
}
