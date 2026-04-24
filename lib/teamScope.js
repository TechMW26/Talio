/**
 * Team-scope helpers
 * ------------------
 * Centralises the "who reports to me?" query used by productivity, tasks,
 * attendance, performance, and any other manager-facing module.
 *
 * Direct-report semantics (any of the following counts as a direct report):
 *   - employee.assignedManager   === managerEmployeeId
 *   - employee.assignedTeamLead  === managerEmployeeId
 *   - employee.reportsTo         === managerEmployeeId   (executive chain)
 *   - employee.reportingManager  === managerEmployeeId   (legacy cascade)
 *
 * The first three are the canonical org-chart edges; reportingManager is
 * kept as a defensive fallback for older docs that may not have any of the
 * canonical pointers populated.
 */

const REPORT_FIELDS = ['assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager']

/**
 * Build a Mongoose `$or` clause for documents that report to `managerEmployeeId`.
 * Pass `extra` to merge additional filters (e.g. `{ status: 'active' }`).
 */
function buildDirectReportsFilter(managerEmployeeId, extra = {}) {
  if (!managerEmployeeId) return null
  return {
    ...extra,
    $or: REPORT_FIELDS.map((f) => ({ [f]: managerEmployeeId })),
  }
}

/**
 * Resolve the set of Employee `_id`s that report (directly) to `managerEmployeeId`.
 * Returns an empty array when no manager id is supplied.
 */
async function getDirectReportEmployeeIds(EmployeeModel, managerEmployeeId, { activeOnly = true } = {}) {
  if (!managerEmployeeId || !EmployeeModel) return []
  const filter = buildDirectReportsFilter(managerEmployeeId, activeOnly ? { status: 'active' } : {})
  if (!filter) return []
  return EmployeeModel.find(filter).distinct('_id')
}

/**
 * True when `targetEmployee` reports (directly) to `managerEmployeeId`
 * via any of the canonical relationship fields.
 */
function isDirectReport(targetEmployee, managerEmployeeId) {
  if (!targetEmployee || !managerEmployeeId) return false
  const mid = String(managerEmployeeId)
  for (const f of REPORT_FIELDS) {
    const v = targetEmployee[f]
    if (!v) continue
    const id = typeof v === 'object' ? (v._id || v.id || v) : v
    if (String(id) === mid) return true
  }
  return false
}

module.exports = {
  REPORT_FIELDS,
  buildDirectReportsFilter,
  getDirectReportEmployeeIds,
  isDirectReport,
}
