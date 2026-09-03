import { NextResponse } from 'next/server'
import { getAuthAndModels, hasRole } from '@/lib/auth'
import {
    validatePermissionsShape,
    normalizePermissionsShape,
    PERMISSIONS_SCHEMA,
    PAGE_SLUGS,
} from '@/lib/permissions'
import { SYSTEM_ROLE_DEFINITIONS } from '@/lib/systemRoles'
import { logRBACEvent, extractRequestMeta } from '@/lib/rbacAudit'

// GET /api/rbac/roles — list all roles for the tenant
export async function GET(request) {
    try {
        const auth = await getAuthAndModels(request, ['Role', 'User'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { user, models, tenant } = auth

        if (!hasRole(user, ['admin'])) {
            return NextResponse.json(
                { success: false, message: 'Only admins can view roles' },
                { status: 403 }
            )
        }

        const roles = await models.Role.find({ company: { $exists: true } })
            .sort({ isSystemRole: -1, name: 1 })
            .lean()

        // Attach user count per role
        const roleCounts = await models.User.aggregate([
            { $match: { roleId: { $ne: null }, isActive: true } },
            { $group: { _id: '$roleId', count: { $sum: 1 } } },
        ])
        const countMap = {}
        for (const r of roleCounts) {
            countMap[r._id.toString()] = r.count
        }

        const rolesWithCounts = roles.map((role) => {
            const fallbackPermissions = role.isSystemRole
                ? SYSTEM_ROLE_DEFINITIONS[role.name]?.buildPermissions?.()
                : null

            return {
                ...role,
                permissions: normalizePermissionsShape(role.permissions, fallbackPermissions),
                userCount: countMap[role._id.toString()] || 0,
            }
        })

        return NextResponse.json({ success: true, data: rolesWithCounts })
    } catch (error) {
        console.error('[RBAC] List roles error:', error)
        return NextResponse.json(
            { success: false, message: 'Failed to fetch roles' },
            { status: 500 }
        )
    }
}

// POST /api/rbac/roles — create a new custom role
export async function POST(request) {
    try {
        const auth = await getAuthAndModels(request, ['Role', 'Company'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { user, models, tenant } = auth

        if (!hasRole(user, ['admin'])) {
            return NextResponse.json(
                { success: false, message: 'Only admins can create roles' },
                { status: 403 }
            )
        }

        const data = await request.json()
        const { name, displayLabel, description, permissions } = data

        // Validation
        if (!name || !displayLabel) {
            return NextResponse.json(
                { success: false, message: 'Name and display label are required' },
                { status: 400 }
            )
        }

        // Sanitize name: lowercase, alphanumeric + underscore only
        const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_')

        // Prevent creating roles with system role names
        if (SYSTEM_ROLE_DEFINITIONS[sanitizedName]) {
            return NextResponse.json(
                { success: false, message: 'Cannot create a role with a system role name' },
                { status: 400 }
            )
        }

        // Check for duplicates
        const existing = await models.Role.findOne({
            company: { $exists: true },
            name: sanitizedName,
        })
        if (existing) {
            return NextResponse.json(
                { success: false, message: 'A role with this name already exists' },
                { status: 400 }
            )
        }

        // Validate permissions shape
        if (!permissions) {
            return NextResponse.json(
                { success: false, message: 'Permissions object is required' },
                { status: 400 }
            )
        }
        const normalizedPermissions = normalizePermissionsShape(permissions)
        const validation = validatePermissionsShape(normalizedPermissions)
        if (!validation.valid) {
            return NextResponse.json(
                { success: false, message: 'Invalid permissions shape', errors: validation.errors },
                { status: 400 }
            )
        }

        // Get company id
        const company = await models.Company.findOne().lean()
        if (!company) {
            return NextResponse.json(
                { success: false, message: 'Company not found' },
                { status: 404 }
            )
        }

        const role = await models.Role.create({
            name: sanitizedName,
            displayLabel: displayLabel.trim(),
            description: description?.trim() || '',
            company: company._id,
            permissions: normalizedPermissions,
            isSystemRole: false,
            createdBy: user._id,
        })

        // Audit log
        const meta = extractRequestMeta(request)
        logRBACEvent(tenant.databaseName, {
            eventType: 'role_created',
            actorId: user._id,
            targetId: role._id,
            targetType: 'Role',
            metadata: { name: sanitizedName, displayLabel },
            ...meta,
        }).catch(() => { })

        return NextResponse.json(
            { success: true, message: 'Role created successfully', data: role },
            { status: 201 }
        )
    } catch (error) {
        console.error('[RBAC] Create role error:', error)
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to create role' },
            { status: 500 }
        )
    }
}
