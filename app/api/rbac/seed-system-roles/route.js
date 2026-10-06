import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { getAuthAndDatabase, hasRole } from '@/lib/auth'
import { SYSTEM_ROLE_DEFINITIONS } from '@/lib/systemRoles'
import { ROLE_STORE_OPTIONS } from '@/lib/platform/firestoreRoles.server'
import { logRBACEvent, extractRequestMeta } from '@/lib/rbacAudit'
export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, ROLE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    if (!hasRole(auth.user, ['admin', 'super_admin'])) return NextResponse.json({ success: false, message: 'Only admins can seed system roles' }, { status: 403 })
    const company = (await auth.database.list('companies', { limit: 1 })).records[0]
    if (!company) return NextResponse.json({ success: false, message: 'Company not found' }, { status: 404 })
    const results = { created: [], updated: [], skipped: [] }
    for (const definition of Object.values(SYSTEM_ROLE_DEFINITIONS)) {
      const found = (await auth.database.list('roles', { filters: [{ field: 'name', operator: '==', value: definition.name }], limit: 2 })).records
      if (found.length > 1 || (found[0] && !found[0].isSystemRole)) throw new Error('System role identity conflict')
      const id = found[0]?._id || createHash('sha256').update(company._id + ':' + definition.name).digest('hex').slice(0, 24)
      const created = await auth.database.transaction(async tx => {
        const current = await tx.get('roles', id)
        if (current && (!current.isSystemRole || current.name !== definition.name)) throw new Error('System role identity conflict')
        const role = { ...current, _id: id, name: definition.name, displayLabel: definition.displayLabel, description: definition.description, company: company._id, permissions: definition.buildPermissions(), isSystemRole: true, updatedAt: new Date() }
        if (current) await tx.replace('roles', role)
        else await tx.create('roles', { ...role, createdBy: auth.user._id, createdAt: new Date() })
        return !current
      })
      results[created ? 'created' : 'updated'].push(definition.name)
    }
    await logRBACEvent(auth.tenant.databaseName, { eventType: 'role_created', actorId: auth.user._id, targetType: 'Role', metadata: { action: 'seed_system_roles', ...results }, ...extractRequestMeta(request) })
    return NextResponse.json({ success: true, message: 'System roles seeded', data: results })
  } catch (error) { return NextResponse.json({ success: false, message: 'Failed to seed system roles' }, { status: 500 }) }
}
