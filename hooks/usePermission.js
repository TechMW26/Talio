'use client'

import { useMemo, useCallback, useEffect, useState } from 'react'
import { checkPermission, getPageSlugForPath } from '@/lib/permissions.shared'
import { getPermissionsForLegacyRole } from '@/lib/systemRoles'

/**
 * usePermission — client-side permission checking hook.
 *
 * Reads permissions from the user object stored in localStorage.
 * Works with the resolved permissionsCache set by the RBAC system.
 *
 * Usage:
 *   const { can, canView, canEdit, canAny } = usePermission()
 *   if (can('employees', 'create')) { ... }
 *   if (canView('payroll')) { ... }
 */
export default function usePermission() {
    const [user, setUser] = useState(null)
    useEffect(() => {
        const refresh = () => {
            try { setUser(JSON.parse(localStorage.getItem('user') || 'null')) }
            catch { setUser(null) }
        }
        refresh()
        window.addEventListener('storage', refresh)
        window.addEventListener('talio:session-updated', refresh)
        return () => {
            window.removeEventListener('storage', refresh)
            window.removeEventListener('talio:session-updated', refresh)
        }
    }, [])
    const permissions = useMemo(() => user?.permissions || user?.permissionsCache
        || (user && !user.roleId ? getPermissionsForLegacyRole(user.role) : null), [user])
    const userRole = user?.role

    /**
     * Check if the current user has a specific permission.
     * Admin always returns true.
     */
    const can = useCallback(
        (pageSlug, action) => {
            if (userRole === 'admin') return true
            if (!permissions) return false
            return checkPermission(permissions, pageSlug, action)
        },
        [permissions, userRole]
    )

    const canView = useCallback(
        (pageSlug) => can(pageSlug, 'view'),
        [can]
    )

    const canEdit = useCallback(
        (pageSlug) => can(pageSlug, 'edit'),
        [can]
    )

    const canCreate = useCallback(
        (pageSlug) => can(pageSlug, 'create'),
        [can]
    )

    const canDelete = useCallback(
        (pageSlug) => can(pageSlug, 'delete'),
        [can]
    )

    /**
     * Check if the user can view a given URL path.
     * Uses PATH_TO_SLUG mapping.
     */
    const canViewPath = useCallback(
        (pathname) => {
            if (userRole === 'admin') return true
            const slug = getPageSlugForPath(pathname)
            if (!slug) return true // Unmapped paths are allowed
            return can(slug, 'view')
        },
        [can, userRole]
    )

    /**
     * Check if the user has any of the provided permissions.
     * Accepts an array of [pageSlug, action] tuples.
     */
    const canAny = useCallback(
        (checks) => {
            if (userRole === 'admin') return true
            return checks.some(([slug, action]) => can(slug, action))
        },
        [can, userRole]
    )

    return {
        can,
        canView,
        canEdit,
        canCreate,
        canDelete,
        canViewPath,
        canAny,
        permissions,
        userRole,
    }
}
