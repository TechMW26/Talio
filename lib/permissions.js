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

// ---------------------------------------------------------------------------
// 7. Server-side permission resolution (Step 4)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Resolve the effective permissions for a user.
 *
 * 1. If user.permissionsCache exists and is < 5 min old, return it.
 * 2. If user has a roleId, fetch the Role document and use its permissions.
 * 3. Otherwise fall back to the system role definition matching user.role.
 *
 * Side-effect: writes permissionsCache + cacheUpdatedAt back to the User document.
 *
 * @param {Object} user - User document (or lean object) with at least _id, role, roleId, permissionsCache, cacheUpdatedAt
 * @param {string} databaseName - Tenant database name
 * @returns {Promise<Object>} - Resolved permissions object
 */
export async function resolveUserPermissions(user, databaseName) {
  // Return cached if fresh
  if (
    user.permissionsCache &&
    user.cacheUpdatedAt &&
    Date.now() - new Date(user.cacheUpdatedAt).getTime() < CACHE_TTL_MS
  ) {
    return user.permissionsCache
  }

  // Lazy import to avoid circular dependency at module load time
  const { getTenantModel } = await import('./tenantModels.js')
  const { getPermissionsForLegacyRole } = await import('./systemRoles.js')

  let permissions = null

  // Try role document first
  if (user.roleId) {
    try {
      const Role = await getTenantModel(databaseName, 'Role')
      const role = await Role.findById(user.roleId).lean()
      if (role?.permissions) {
        permissions = role.permissions
      }
    } catch (err) {
      console.error('[RBAC] Failed to fetch Role for user', user._id, err.message)
    }
  }

  // Fallback: map legacy role string to system role permissions
  if (!permissions) {
    permissions = getPermissionsForLegacyRole(user.role)
  }

  // Write cache back to user document (fire-and-forget to avoid blocking)
  try {
    const User = await getTenantModel(databaseName, 'User')
    await User.updateOne(
      { _id: user._id },
      { $set: { permissionsCache: permissions, cacheUpdatedAt: new Date() } }
    )
  } catch (err) {
    console.error('[RBAC] Failed to cache permissions for user', user._id, err.message)
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
    const { getTenantModel } = await import('./tenantModels.js')
    const User = await getTenantModel(databaseName, 'User')
    await User.updateMany(
      { _id: { $in: userIds } },
      { $set: { permissionsCache: null, cacheUpdatedAt: null } }
    )
  } catch (err) {
    console.error('[RBAC] Failed to invalidate permissions cache:', err.message)
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
 *     const { user, models, tenant, denied } = await guard(request, ['User', 'Employee'])
 *     if (denied) return denied
 *     // ... handler logic
 *   }
 *
 * @param {string} pageSlug - A key from PAGE_SLUGS
 * @param {string} action - A key from ACTIONS
 * @returns {Function} async (request, modelNames) => { user, models, tenant, denied }
 */
export function requirePermission(pageSlug, action) {
  return async function (request, modelNames = []) {
    // Lazy import to avoid circular dependency
    const { getAuthAndModels } = await import('./auth.js')
    const { NextResponse } = await import('next/server')
    const { logRBACEvent, extractRequestMeta } = await import('./rbacAudit.js')

    // Authenticate + load models (always include User for permission resolution)
    const modelsToLoad = [...new Set([...modelNames, 'User'])]
    const auth = await getAuthAndModels(request, modelsToLoad)

    if (!auth.success) {
      return {
        denied: NextResponse.json(
          { success: false, message: auth.message },
          { status: 401 }
        ),
      }
    }

    // Fetch full user with RBAC fields (the auth cache may not include them)
    const fullUser = await auth.models.User.findById(auth.user._id)
      .select('_id email role roleId permissionsCache cacheUpdatedAt isDepartmentHead headOfDepartments isDepartmentManager departmentManagerOf teamLeaderOf teamMemberOf employeeId')
      .lean()

    if (!fullUser) {
      return {
        denied: NextResponse.json(
          { success: false, message: 'User not found' },
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
        isDepartmentHead: fullUser.isDepartmentHead,
        headOfDepartments: fullUser.headOfDepartments,
        isDepartmentManager: fullUser.isDepartmentManager,
        departmentManagerOf: fullUser.departmentManagerOf,
        teamLeaderOf: fullUser.teamLeaderOf,
        teamMemberOf: fullUser.teamMemberOf,
        permissions,
      },
      models: auth.models,
      tenant: auth.tenant,
      denied: null,
    }
  }
}
