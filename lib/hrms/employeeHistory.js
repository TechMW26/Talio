const label = value => String(value || '').replaceAll('_', ' ')
const date = value => {
  const parsed = value ? new Date(value) : null
  return parsed && !Number.isNaN(+parsed) ? parsed.toISOString() : null
}

// Explicit DTO: never send onboarding evidence, bank details, or salary amounts.
export function employeeHistory(employee, approvals = [], appraisals = [], workflows = []) {
  const events = []
  const add = (id, category, title, at, status, detail = '') => events.push({ id, category, title, at: date(at), status: label(status), detail })
  const lifecycle = employee.lifecycle || {}, probation = lifecycle.probation || {}, exit = lifecycle.offboarding || {}
  if (employee.dateOfJoining) add('joined', 'other', 'Joined the organization', employee.dateOfJoining, 'recorded')
  for (const item of lifecycle.onboarding?.checklist || []) if (item.completed) add(`onboarding:${item.key}`, 'other', item.label, item.completedAt, 'completed')
  if (probation.confirmedAt) add('confirmed', 'other', 'Probation confirmed', probation.confirmedAt, 'confirmed')
  if (probation.extendedAt) add('extended', 'other', 'Probation extended', probation.extendedAt, probation.status, probation.extensionReason)
  if (probation.pip?.enabled) add('current-pip', 'pip', 'Performance improvement plan', probation.extendedAt, 'recorded', [probation.pip.goals, probation.pip.reviewDate ? `Review date: ${String(probation.pip.reviewDate).slice(0, 10)}` : ''].filter(Boolean).join('\n'))
  for (const row of approvals) {
    add(`probation:${row._id}`, row.pip?.enabled ? 'pip' : 'other', row.pip?.enabled ? 'PIP / probation extension request' : `Probation ${label(row.requestType)} request`, row.createdAt, row.status, row.requestRemarks)
    if (row.decidedAt) add(`probation-decision:${row._id}`, row.pip?.enabled ? 'pip' : 'other', 'Probation request decision', row.decidedAt, row.status, row.decisionRemarks)
  }
  for (const row of appraisals) {
    add(`appraisal:${row._id}`, 'appraisal', `Appraisal · ${row.reviewPeriod || 'Review'}`, row.createdAt, row.status)
    for (const [index, event] of (row.timeline || []).entries()) if (event.type !== 'submitted') add(`appraisal:${row._id}:${index}`, 'appraisal', `Appraisal · ${label(event.type)}`, event.at, event.type, event.message)
  }
  for (const row of workflows) add(`workflow:${row._id}`, /promotion/i.test(row.title || '') ? 'promotion' : 'other', row.title || label(row.module), row.createdAt, row.status, row.caseNumber ? `Case ${row.caseNumber}` : '')
  if (exit.resignationDate) add('exit-start', 'other', 'Separation initiated', exit.resignationDate, exit.status, label(exit.separationType))
  if (exit.completedAt) add('exit-complete', 'other', 'Offboarding completed', exit.completedAt, 'completed')
  return events.sort((a, b) => (b.at ? +new Date(b.at) : 0) - (a.at ? +new Date(a.at) : 0) || a.id.localeCompare(b.id))
}
