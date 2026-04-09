import { NextResponse } from 'next/server'
import { getAuthAndModels, hasRole } from '@/lib/auth'

// GET /api/rbac/audit-log — list recent RBAC audit events
export async function GET(request) {
    try {
        const auth = await getAuthAndModels(request, ['RBACAuditLog', 'User'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { user, models } = auth

        if (!hasRole(user, ['admin'])) {
            return NextResponse.json(
                { success: false, message: 'Only admins can view audit logs' },
                { status: 403 }
            )
        }

        const { searchParams } = new URL(request.url)
        const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
        const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)))
        const eventType = searchParams.get('eventType')

        const filter = {}
        if (eventType) {
            filter.eventType = eventType
        }

        const [logs, total] = await Promise.all([
            models.RBACAuditLog.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            models.RBACAuditLog.countDocuments(filter),
        ])

        // Resolve actor names
        const actorIds = [...new Set(logs.filter((l) => l.actorId).map((l) => l.actorId.toString()))]
        const actors = actorIds.length
            ? await models.User.find({ _id: { $in: actorIds } }, { _id: 1, email: 1 }).lean()
            : []
        const actorMap = {}
        for (const a of actors) {
            actorMap[a._id.toString()] = a.email
        }

        const enrichedLogs = logs.map((log) => ({
            ...log,
            actorEmail: log.actorId ? actorMap[log.actorId.toString()] || 'Unknown' : 'System',
        }))

        return NextResponse.json({
            success: true,
            data: enrichedLogs,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        })
    } catch (error) {
        console.error('[RBAC] Audit log error:', error)
        return NextResponse.json(
            { success: false, message: 'Failed to fetch audit logs' },
            { status: 500 }
        )
    }
}
