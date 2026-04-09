import { NextResponse } from 'next/server'
import { getAuthAndModels, hasRole } from '@/lib/auth'
import { validatePermissionsShape, invalidatePermissionsCache } from '@/lib/permissions'
import { SYSTEM_ROLE_DEFINITIONS } from '@/lib/systemRoles'
import { logRBACEvent, extractRequestMeta } from '@/lib/rbacAudit'

// GET /api/rbac/roles/[id] — get a single role
export async function GET(request, { params }) {
    try {
        const { id } = await params
        const auth = await getAuthAndModels(request, ['Role'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { user, models } = auth

        if (!hasRole(user, ['admin'])) {
            return NextResponse.json(
                { success: false, message: 'Only admins can view role details' },
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

        return NextResponse.json({ success: true, data: role })
    } catch (error) {
        console.error('[RBAC] Get role error:', error)
        return NextResponse.json(
            { success: false, message: 'Failed to fetch role' },
            { status: 500 }
        )
    }
}

// PUT /api/rbac/roles/[id] — update a role's permissions or metadata
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
                { success: false, message: 'Only admins can update roles' },
                { status: 403 }
            )
        }

        const role = await models.Role.findById(id)
        if (!role) {
            return NextResponse.json(
                { success: false, message: 'Role not found' },
                { status: 404 }
            )
        }

        const data = await request.json()
        const beforeSnapshot = {
            displayLabel: role.displayLabel,
            description: role.description,
        }

        // Update metadata
        if (data.displayLabel) role.displayLabel = data.displayLabel.trim()
        if (data.description !== undefined) role.description = data.description.trim()

        // System roles: allow updating permissions but not name
        if (role.isSystemRole && data.name && data.name !== role.name) {
            return NextResponse.json(
                { success: false, message: 'Cannot rename a system role' },
                { status: 400 }
            )
        }

        // Update permissions
        if (data.permissions) {
            const validation = validatePermissionsShape(data.permissions)
            if (!validation.valid) {
                return NextResponse.json(
                    { success: false, message: 'Invalid permissions shape', errors: validation.errors },
                    { status: 400 }
                )
            }
            role.permissions = data.permissions
        }

        await role.save()

        // Invalidate permissions cache for all users assigned to this role
        const affectedUsers = await models.User.find(
            { roleId: role._id, isActive: true },
            { _id: 1 }
        ).lean()
        const userIds = affectedUsers.map((u) => u._id.toString())
        await invalidatePermissionsCache(tenant.databaseName, userIds)

        // Audit log
        const meta = extractRequestMeta(request)
        logRBACEvent(tenant.databaseName, {
            eventType: 'role_updated',
            actorId: user._id,
            targetId: role._id,
            targetType: 'Role',
            metadata: {
                before: beforeSnapshot,
                after: { displayLabel: role.displayLabel, description: role.description },
                permissionsChanged: !!data.permissions,
                affectedUserCount: userIds.length,
            },
            ...meta,
        }).catch(() => { })

        return NextResponse.json({
            success: true,
            message: 'Role updated successfully',
            data: role.toObject(),
        })
    } catch (error) {
        console.error('[RBAC] Update role error:', error)
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to update role' },
            { status: 500 }
        )
    }
}

// DELETE /api/rbac/roles/[id] — delete a custom role
export async function DELETE(request, { params }) {
    try {
        const { id } = await params
        const auth = await getAuthAndModels(request, ['Role', 'User'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { user, models, tenant } = auth

        if (!hasRole(user, ['admin'])) {
            return NextResponse.json(
                { success: false, message: 'Only admins can delete roles' },
                { status: 403 }
            )
        }

        const role = await models.Role.findById(id)
        if (!role) {
            return NextResponse.json(
                { success: false, message: 'Role not found' },
                { status: 404 }
            )
        }

        if (role.isSystemRole) {
            return NextResponse.json(
                { success: false, message: 'System roles cannot be deleted' },
                { status: 400 }
            )
        }

        // Unassign users: set roleId to null, clear cache
        const affectedUsers = await models.User.find(
            { roleId: role._id, isActive: true },
            { _id: 1 }
        ).lean()
        const userIds = affectedUsers.map((u) => u._id.toString())

        if (userIds.length > 0) {
            await models.User.updateMany(
                { roleId: role._id },
                { $set: { roleId: null, permissionsCache: null, cacheUpdatedAt: null } }
            )
        }

        await models.Role.deleteOne({ _id: role._id })

        // Audit log
        const meta = extractRequestMeta(request)
        logRBACEvent(tenant.databaseName, {
            eventType: 'role_deleted',
            actorId: user._id,
            targetId: role._id,
            targetType: 'Role',
            metadata: {
                roleName: role.name,
                displayLabel: role.displayLabel,
                unassignedUserCount: userIds.length,
            },
            ...meta,
        }).catch(() => { })

        return NextResponse.json({
            success: true,
            message: `Role "${role.displayLabel}" deleted. ${userIds.length} user(s) reverted to default permissions.`,
        })
    } catch (error) {
        console.error('[RBAC] Delete role error:', error)
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to delete role' },
            { status: 500 }
        )
    }
}
