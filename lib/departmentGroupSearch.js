export function hasActiveGroupSearch(searchQuery) {
  return Boolean(String(searchQuery || '').trim())
}

export function normalizeGroupSearch(searchQuery) {
  return String(searchQuery || '').trim().toLocaleLowerCase()
}

export function filterDepartmentGroupEmployees({
  departmentName,
  employees = [],
  searchQuery,
  matchesEmployee,
}) {
  const normalizedSearch = normalizeGroupSearch(searchQuery)
  if (!normalizedSearch) return employees
  if (String(departmentName || '').toLocaleLowerCase().includes(normalizedSearch)) return employees
  if (typeof matchesEmployee !== 'function') return []
  return employees.filter(employee => matchesEmployee(employee, normalizedSearch))
}

export function isDepartmentGroupExpanded({
  searchQuery,
  expandedDepartments,
  departmentId,
  defaultExpanded = false,
}) {
  if (hasActiveGroupSearch(searchQuery)) return true
  if (Object.prototype.hasOwnProperty.call(expandedDepartments || {}, departmentId)) {
    return Boolean(expandedDepartments[departmentId])
  }
  return defaultExpanded
}
