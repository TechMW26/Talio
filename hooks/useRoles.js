'use client'

import useAuthedSWR from '@/hooks/useAuthedSWR'

/**
 * Shared hook to fetch all roles (system + custom) for the current tenant.
 * Used by every role dropdown/selector in the app.
 *
 * Returns:
 *   roles    — array of { _id, name, displayLabel, isSystemRole, description }
 *   loading  — true while fetching
 *   error    — error object if fetch failed
 *   mutate   — call to invalidate the cache (e.g. after creating / deleting a role)
 */
export default function useRoles() {
    const { data, error, isLoading, mutate } = useAuthedSWR('/api/rbac/roles/list', {
        revalidateOnFocus: false,
        dedupingInterval: 60_000, // avoid duplicate requests within 60 s
    })

    return {
        roles: data?.data ?? [],
        loading: isLoading,
        error,
        mutate,
    }
}

/**
 * Given a role name or roleId, return the human-readable display label.
 *
 * @param {string} roleNameOrId — either a role `_id` or a legacy role `name` string
 * @param {Array}  roles        — the roles array returned by useRoles()
 * @returns {string} display label
 */
export function getRoleDisplayLabel(roleNameOrId, roles) {
    if (!roleNameOrId) return 'Unknown'
    if (!roles || roles.length === 0) {
        // Fallback: humanise the raw slug
        return formatRoleSlug(roleNameOrId)
    }
    const match = roles.find(
        (r) => r._id === roleNameOrId || r.name === roleNameOrId
    )
    return match ? match.displayLabel : formatRoleSlug(roleNameOrId)
}

/** Capitalise + replace underscores → spaces */
function formatRoleSlug(slug) {
    if (!slug) return 'Unknown'
    return slug
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
}
