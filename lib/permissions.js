/**
 * lib/permissions.js
 *
 * Single source of truth for the entire RBAC permission system.
 * Re-exports all client-safe constants/utilities from permissions.shared.js
 * and adds server-only functions that depend on Node.js / DB modules.
 *
 * Client components should import from '@/lib/permissions.shared' instead
 * to avoid pulling Node.js modules into the browser bundle.
 */

// Re-export everything from the client-safe shared module
export * from './permissions.shared.js'

// Import what we need from shared for use in server functions below
import { checkPermission } from './permissions.shared.js'
import { getFirestoreTenantDatabase } from './platform/firestoreApplication.server'

// ---------------------------------------------------------------------------
// 7. Server-side permission resolution (Step 4)
// ---------------------------------------------------------------------------

/**
 * Resolve the effective permissions for a user.
 *
 * Custom roles are read fresh from the tenant repository. Legacy roles use the
 * shared static definition and do not need a permissions-cache database write.
 * Old persisted cache fields are not authoritative after role changes.
 *
 * @param {Object} user - Current user document with at least _id, role, roleId
 * @param {string} databaseName - Tenant database name
 * @returns {Promise<Object>} - Resolved permissions object
 */
export async function resolveUserPermissions(user, databaseName) {
  // Lazy import to avoid circular dependency at module load time
  const { getPermissionsForLegacyRole } = await import('./systemRoles.js')
  const database = await getFirestoreTenantDatabase(databaseName)

  let permissions = null

  // Try role document first
  if (user.roleId) {
    // A provider error must not elevate a restricted custom role to the user's
    // legacy role. Only a genuinely absent role may use legacy permissions.
    const role = await database.get('roles', String(user.roleId))
    if (role?.permissions && !role.deletedAt) permissions = role.permissions
  }

  // Fallback: map legacy role string to system role permissions
  if (!permissions) {
    permissions = getPermissionsForLegacyRole(user.role)
  }

  return permissions
}

/**
 * Invalidate permissionsCache for one or more users.
 * Called when a role is updated/deleted.
 *
 * @param {string} databaseName
 * @param {Array<string>} userIds - Array of User _id strings. Pass empty to skip.
 */
export async function invalidatePermissionsCache(databaseName, userIds) {
  if (!userIds?.length) return
  try {
    const database = await getFirestoreTenantDatabase(databaseName)
    const ids = [...new Set(userIds.map(String))]
    for (let offset = 0; offset < ids.length; offset += 50) {
      await database.transaction(async tx => {
        for (const id of ids.slice(offset, offset + 50)) {
          const user = await tx.get('users', id)
          if (user) await tx.replace('users', { ...user, permissionsCache: null, cacheUpdatedAt: null })
        }
      })
    }
  } catch (err) {
    console.error('[RBAC] Failed to invalidate permissions cache:', err.message)
    throw err
  }
}

// ---------------------------------------------------------------------------
// 8. requirePermission middleware (Step 5)
// ---------------------------------------------------------------------------

/**
 * Returns an async function that can be called at the top of an API route handler.
 * Verifies the user has the required page+action permission.
 *
 * Usage in a route.js:
 *   import { requirePermission } from '@/lib/permissions'
 *   const guard = requirePermission('employees', 'view')
 *
 *   export async function GET(request) {
 *     const { user, database, tenant, denied } = await guard(request)
 *     if (denied) return denied
 *     // ... handler logic
 *   }
 *
 * @param {string} pageSlug - A key from PAGE_SLUGS
 * @param {string} action - A key from ACTIONS
 * @returns {Function} async (request) => { user, database, tenant, denied }
 */
export function requirePermission(pageSlug, action) {
  return async function (request) {
    // Lazy import to avoid circular dependency
    const { getAuthAndDatabase } = await import('./auth.js')
    const { NextResponse } = await import('next/server')
    const { logRBACEvent, extractRequestMeta } = await import('./rbacAudit.js')

    const auth = await getAuthAndDatabase(request)

    if (!auth.success) {
      return {
        denied: NextResponse.json(
          { success: false, message: auth.message },
          { status: auth.status || 401 }
        ),
      }
    }

    // Fetch full user with RBAC fields (the auth cache may not include them)
    const database = await getFirestoreTenantDatabase(auth.tenant.databaseName)
    const fullUser = await database.get('users', String(auth.user._id))

    if (!fullUser?.isActive) {
      return {
        denied: NextResponse.json(
          { success: false, message: 'User not found or inactive' },
          { status: 401 }
        ),
      }
    }

    // Resolve permissions
    const permissions = await resolveUserPermissions(fullUser, auth.tenant.databaseName)
    const allowed = checkPermission(permissions, pageSlug, action)

    if (!allowed) {
      // Log the denial (fire-and-forget)
      const meta = extractRequestMeta(request)
      logRBACEvent(auth.tenant.databaseName, {
        eventType: 'permission_denied',
        actorId: fullUser._id,
        targetId: null,
        targetType: null,
        metadata: {
          pageSlug,
          action,
          route: request.url,
          userRole: fullUser.role,
        },
        ...meta,
      }).catch(() => { })

      return {
        denied: NextResponse.json(
          {
            success: false,
            error: 'PERMISSION_DENIED',
            pageSlug,
            action,
            message: `You do not have permission to ${action} on ${pageSlug}`,
          },
          { status: 403 }
        ),
      }
    }

    // Merge hierarchy fields into auth user object for downstream use
    return {
      user: {
        ...auth.user,
        employeeId: fullUser.employeeId || auth.user.employeeId,
        isDepartmentHead: fullUser.isDepartmentHead,
        headOfDepartments: fullUser.headOfDepartments,
        isDepartmentManager: fullUser.isDepartmentManager,
        departmentManagerOf: fullUser.departmentManagerOf,
        teamLeaderOf: fullUser.teamLeaderOf,
        teamMemberOf: fullUser.teamMemberOf,
        permissions,
      },
      database,
      tenant: auth.tenant,
      denied: null,
    }
  }
}
