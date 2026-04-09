'use client'

import { useMemo, useCallback } from 'react'
import { checkPermission, getPageSlugForPath } from '@/lib/permissions.shared'

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
    // Read permissions from localStorage user object
    const permissions = useMemo(() => {
        if (typeof window === 'undefined') return null
        try {
            const userData = localStorage.getItem('user')
            if (!userData) return null
            const user = JSON.parse(userData)
            return user.permissions || user.permissionsCache || null
        } catch {
            return null
        }
    }, [])

    const userRole = useMemo(() => {
        if (typeof window === 'undefined') return null
        try {
            const userData = localStorage.getItem('user')
            if (!userData) return null
            return JSON.parse(userData).role
        } catch {
            return null
        }
    }, [])

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
