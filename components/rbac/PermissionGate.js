'use client'

import usePermission from '@/hooks/usePermission'

/**
 * PermissionGate — conditionally renders children based on permissions.
 *
 * Usage:
 *   <PermissionGate slug="employees" action="create">
 *     <Button>Add Employee</Button>
 *   </PermissionGate>
 *
 *   <PermissionGate slug="payroll" action="view" fallback={<p>No access</p>}>
 *     <PayrollTable />
 *   </PermissionGate>
 *
 *   <PermissionGate anyOf={[['employees', 'create'], ['employees', 'edit']]}>
 *     <EmployeeForm />
 *   </PermissionGate>
 */
export default function PermissionGate({
    slug,
    action = 'view',
    anyOf,
    children,
    fallback = null,
}) {
    const { can, canAny } = usePermission()

    let allowed = false
    if (anyOf) {
        allowed = canAny(anyOf)
    } else if (slug) {
        allowed = can(slug, action)
    }

    return allowed ? children : fallback
}
