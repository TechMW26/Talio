import { NextResponse } from 'next/server'
import { getAuthAndModels, hasRole } from '@/lib/auth'
import { SYSTEM_ROLE_DEFINITIONS } from '@/lib/systemRoles'
import { logRBACEvent, extractRequestMeta } from '@/lib/rbacAudit'

// POST /api/rbac/seed-system-roles — seed or refresh system roles
export async function POST(request) {
    try {
        const auth = await getAuthAndModels(request, ['Role', 'Company'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { user, models, tenant } = auth

        if (!hasRole(user, ['admin'])) {
            return NextResponse.json(
                { success: false, message: 'Only admins can seed system roles' },
                { status: 403 }
            )
        }

        const company = await models.Company.findOne().lean()
        if (!company) {
            return NextResponse.json(
                { success: false, message: 'Company not found' },
                { status: 404 }
            )
        }

        const results = { created: [], updated: [], skipped: [] }

        for (const [key, def] of Object.entries(SYSTEM_ROLE_DEFINITIONS)) {
            const permissions = def.buildPermissions()
            const existing = await models.Role.findOne({
                company: company._id,
                name: def.name,
                isSystemRole: true,
            })

            if (existing) {
                // Update permissions to latest definition
                existing.permissions = permissions
                existing.displayLabel = def.displayLabel
                existing.description = def.description
                await existing.save()
                results.updated.push(def.name)
            } else {
                await models.Role.create({
                    name: def.name,
                    displayLabel: def.displayLabel,
                    description: def.description,
                    company: company._id,
                    permissions,
                    isSystemRole: true,
                    createdBy: user._id,
                })
                results.created.push(def.name)
            }
        }

        // Audit log
        const meta = extractRequestMeta(request)
        logRBACEvent(tenant.databaseName, {
            eventType: 'role_created',
            actorId: user._id,
            targetId: null,
            targetType: 'Role',
            metadata: {
                action: 'seed_system_roles',
                created: results.created,
                updated: results.updated,
            },
            ...meta,
        }).catch(() => { })

        return NextResponse.json({
            success: true,
            message: `System roles seeded: ${results.created.length} created, ${results.updated.length} updated`,
            data: results,
        })
    } catch (error) {
        console.error('[RBAC] Seed system roles error:', error)
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to seed system roles' },
            { status: 500 }
        )
    }
}
