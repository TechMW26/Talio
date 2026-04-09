import { NextResponse } from 'next/server'
import { getAuthAndModels, hasRole } from '@/lib/auth'
import { invalidatePermissionsCache } from '@/lib/permissions'
import { logRBACEvent, extractRequestMeta } from '@/lib/rbacAudit'

// PUT /api/rbac/roles/[id]/assign — assign role to users
// Body: { userIds: string[] }
export async function PUT(request, { params }) {
    try {
        const { id } = await params
        const auth = await getAuthAndModels(request, ['Role', 'User'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { user, models, tenant } = auth

        if (!hasRole(user, ['admin'])) {
            return NextResponse.json(
                { success: false, message: 'Only admins can assign roles' },
                { status: 403 }
            )
        }

        const role = await models.Role.findById(id).lean()
        if (!role) {
            return NextResponse.json(
                { success: false, message: 'Role not found' },
                { status: 404 }
            )
        }

        const data = await request.json()
        const { userIds } = data

        if (!Array.isArray(userIds) || userIds.length === 0) {
            return NextResponse.json(
                { success: false, message: 'userIds must be a non-empty array' },
                { status: 400 }
            )
        }

        // Assign role to users
        const result = await models.User.updateMany(
            { _id: { $in: userIds }, isActive: true },
            { $set: { roleId: role._id, permissionsCache: null, cacheUpdatedAt: null } }
        )

        // Audit log
        const meta = extractRequestMeta(request)
        logRBACEvent(tenant.databaseName, {
            eventType: 'user_role_changed',
            actorId: user._id,
            targetId: role._id,
            targetType: 'Role',
            metadata: {
                roleName: role.name,
                displayLabel: role.displayLabel,
                assignedUserIds: userIds,
                modifiedCount: result.modifiedCount,
            },
            ...meta,
        }).catch(() => { })

        return NextResponse.json({
            success: true,
            message: `Role "${role.displayLabel}" assigned to ${result.modifiedCount} user(s)`,
            data: { modifiedCount: result.modifiedCount },
        })
    } catch (error) {
        console.error('[RBAC] Assign role error:', error)
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to assign role' },
            { status: 500 }
        )
    }
}
