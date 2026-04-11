export function getUserMenuPermissions(user) {
  return user?.permissions || user?.permissionsCache || null
}

export function getEffectiveMenuRole(user, { isDepartmentHead = false } = {}) {
  if (!user) return null
  return (isDepartmentHead && user.role !== 'admin') ? 'department_head' : user.role
}

export function getMenuTemplateRole(user, { isDepartmentHead = false, permissions } = {}) {
  if (!user) return null

  const resolvedPermissions = permissions === undefined
    ? getUserMenuPermissions(user)
    : permissions

  const effectiveRole = getEffectiveMenuRole(user, { isDepartmentHead })
  return (user.role !== 'admin' && user.roleId && resolvedPermissions) ? 'admin' : effectiveRole
}