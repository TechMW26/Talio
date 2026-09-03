export const PROBATION_APPROVER_FIELDS = Object.freeze([
  'reportingManager',
  'assignedTeamLead',
  'assignedManager',
  'reportsTo',
])

function objectIdString(value) {
  const id = value?._id || value?.id || value
  return id?.toString?.() || (id ? String(id) : '')
}

export function getProbationApproverCandidates(employee = {}) {
  const seen = new Set()
  const employeeId = objectIdString(employee._id)

  return PROBATION_APPROVER_FIELDS.flatMap((source) => {
    const employeeIdValue = objectIdString(employee[source])
    if (!employeeIdValue || employeeIdValue === employeeId || seen.has(employeeIdValue)) return []
    seen.add(employeeIdValue)
    return [{ employeeId: employeeIdValue, source }]
  })
}

export function resolveProbationApprover(employee, users = []) {
  const usersByEmployee = new Map(
    users
      .filter((user) => user?.isActive !== false)
      .map((user) => [objectIdString(user.employeeId), user]),
  )

  for (const candidate of getProbationApproverCandidates(employee)) {
    const user = usersByEmployee.get(candidate.employeeId)
    if (user) return { ...candidate, userId: objectIdString(user._id), user }
  }

  return null
}

export function validateProbationApprovalRequest(input = {}) {
  const requestType = String(input.requestType || '').trim()
  if (!['confirmation', 'extension'].includes(requestType)) {
    throw new Error('Choose confirmation or extension')
  }

  const requestRemarks = String(input.remarks || '').trim().slice(0, 2000)
  if (requestType === 'extension') {
    const extensionMonths = Number.parseInt(input.months, 10)
    if (!Number.isInteger(extensionMonths) || extensionMonths < 1 || extensionMonths > 24) {
      throw new Error('Extension must be between 1 and 24 months')
    }
    if (!requestRemarks) throw new Error('A reason for the probation extension is required')
    return { requestType, extensionMonths, requestRemarks }
  }

  return { requestType, extensionMonths: null, requestRemarks }
}

export function requireDecisionRemarks(value) {
  const remarks = String(value || '').trim().slice(0, 2000)
  if (!remarks) throw new Error('Manager remarks are required')
  return remarks
}

export function approverSourceLabel(source) {
  return ({
    reportingManager: 'reporting manager',
    assignedTeamLead: 'team lead',
    assignedManager: 'manager',
    reportsTo: 'reporting authority',
  })[source] || 'manager'
}
