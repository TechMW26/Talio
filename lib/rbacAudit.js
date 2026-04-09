/**
 * lib/rbacAudit.js
 *
 * Helper to log RBAC events to the RBACAuditLog collection.
 * Called from role mutation APIs and requirePermission middleware.
 */

import { getTenantModel } from './tenantModels'

/**
 * Log an RBAC event.
 *
 * @param {string} databaseName - Tenant database name
 * @param {Object} eventData
 * @param {string} eventData.eventType - One of: role_created, role_updated, role_deleted, user_role_changed, permission_denied
 * @param {string} [eventData.actorId] - User who performed the action
 * @param {string} [eventData.targetId] - The affected Role or User ObjectId
 * @param {string} [eventData.targetType] - 'Role' or 'User'
 * @param {Object} [eventData.metadata] - Before/after snapshots, route info, etc.
 * @param {string} [eventData.ipAddress]
 * @param {string} [eventData.userAgent]
 */
export async function logRBACEvent(databaseName, eventData) {
    try {
        if (!databaseName) return
        const RBACAuditLog = await getTenantModel(databaseName, 'RBACAuditLog')
        await RBACAuditLog.create({
            eventType: eventData.eventType,
            actorId: eventData.actorId || null,
            targetId: eventData.targetId || null,
            targetType: eventData.targetType || null,
            metadata: eventData.metadata || {},
            ipAddress: eventData.ipAddress || null,
            userAgent: eventData.userAgent || null,
        })
    } catch (error) {
        // Audit logging must never block the main request
        console.error('[RBAC AUDIT] Failed to log event:', error.message)
    }
}

/**
 * Extract IP address and user-agent from a Next.js request.
 */
export function extractRequestMeta(request) {
    return {
        ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
            || request.headers.get('x-real-ip')
            || 'unknown',
        userAgent: request.headers.get('user-agent') || 'unknown',
    }
}
