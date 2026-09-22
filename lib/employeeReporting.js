const ASSIGNMENT_FIELDS = ['assignedTeamLead', 'assignedManager', 'reportsTo']

export function reportingEmployeeId(value) {
  return value ? String(value._id || value.id || value) : null
}

/** The saved direct manager is authoritative; legacy assignments are fallbacks. */
export function getReportingParent(employee = {}) {
  return reportingEmployeeId(employee.reportingManager)
    || ASSIGNMENT_FIELDS.map(field => reportingEmployeeId(employee[field])).find(Boolean)
    || null
}

/** Recompute derived routing on assignment edits, including explicit removals. */
export function syncReportingManager(update, existing = {}) {
  if (Object.hasOwn(update, 'reportingManager') && update.reportingManager) return
  if (!ASSIGNMENT_FIELDS.some(field => Object.hasOwn(update, field))) return
  const merged = { ...existing, ...update, reportingManager: null }
  update.reportingManager = getReportingParent(merged)
}
