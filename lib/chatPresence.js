export function normalizePresenceUpdates(value) {
  if (!value || typeof value !== 'object') return []
  const rows = Array.isArray(value) ? value : value.employeeId ? [value] : Object.values(value)
  return rows.filter(row => row && typeof row === 'object' && typeof row.employeeId === 'string' && row.employeeId.length < 120)
}
