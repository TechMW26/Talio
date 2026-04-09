import { getPageSlugForPath, checkPermission } from '@/lib/permissions.shared'

/**
 * Filter menu items array by the user's resolved RBAC permissions.
 * Returns the filtered array with submenu items also filtered.
 *
 * - Admin users bypass all filtering.
 * - If no permissions are available, returns all items (legacy fallback).
 *
 * @param {Array} menuItems - Menu items from roleBasedMenus
 * @param {Object|null} permissions - Resolved permissions object (from localStorage user)
 * @param {string} userRole - The user's role string
 * @returns {Array} Filtered menu items
 */
export function filterMenuByPermissions(menuItems, permissions, userRole) {
    if (!menuItems.length) return menuItems
    if (userRole === 'admin') return menuItems
    if (!permissions) return menuItems

    return menuItems
        .map((item) => {
            const slug = getPageSlugForPath(item.path)
            const topAllowed = !slug || checkPermission(permissions, slug, 'view')

            if (item.submenu) {
                const filteredSub = item.submenu.filter((sub) => {
                    const subSlug = getPageSlugForPath(sub.path)
                    return !subSlug || checkPermission(permissions, subSlug, 'view')
                })
                if (filteredSub.length === 0 && !topAllowed) return null
                return { ...item, submenu: filteredSub.length > 0 ? filteredSub : undefined }
            }

            return topAllowed ? item : null
        })
        .filter(Boolean)
}

/**
 * Read permissions from localStorage user object.
 */
export function getStoredPermissions() {
    if (typeof window === 'undefined') return null
    try {
        const stored = localStorage.getItem('user')
        if (!stored) return null
        const user = JSON.parse(stored)
        return user.permissions || user.permissionsCache || null
    } catch {
        return null
    }
}
