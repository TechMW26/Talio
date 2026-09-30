export const HR_ROLES = ['hr', 'admin', 'super_admin', 'superadmin']
export const idOf = value => String(value?._id || value || '')
export const failure = (message, status = 400) => Object.assign(new Error(message), { status })
export const isHr = actor => HR_ROLES.includes(actor.role)
export function reasonText(value) {
  if (typeof value !== 'string' || value.trim().length < 5 || value.trim().length > 2000) throw failure('Enter a reason between 5 and 2000 characters')
  return value.trim()
}
export function actionsFor(record, actor) {
  const own = idOf(record.requestedBy) === idOf(actor._id)
  if (own) {
    if (record.status === 'employee_review') return ['accept', 'negotiate', 'withdraw']
    return ['hr_review', 'hierarchy_review', 'hr_relay', 'negotiation_hr'].includes(record.status) ? ['withdraw'] : []
  }
  if (isHr(actor)) {
    if (record.status === 'hr_review') return ['approve', 'reject']
    if (record.status === 'hr_relay') return ['relay', 'return']
    if (record.status === 'negotiation_hr') return ['forward_negotiation']
  }
  return record.status === 'hierarchy_review' && record.reviewers.some(id => idOf(id) === idOf(actor._id)) ? ['propose'] : []
}
export function publicResignation(record, actor) {
  const own = idOf(record.requestedBy) === idOf(actor._id)
  const value = { ...record, own, actions: actionsFor(record, actor) }
  if (own) {
    // A hierarchy draft is not an employee-facing offer until HR relays it.
    if (!['employee_review', 'negotiation_hr', 'accepted', 'completed'].includes(record.status)) value.proposal = null
    const lastRelay = record.timeline.map(e => e.action).lastIndexOf('relay')
    value.timeline = record.timeline.filter((event, index) => event.action !== 'propose' || index < lastRelay)
  }
  return value
}
export function transition(record, actor, input, now = new Date()) {
  if (!actionsFor(record, actor).includes(input.action)) throw failure('You cannot perform this action at the current stage', 403)
  const event = { action: input.action, actor: actor._id, at: now }
  const update = {}
  if (['reject', 'return', 'negotiate', 'propose'].includes(input.action)) event.reason = reasonText(input.reason)
  const next = { approve: 'hierarchy_review', reject: 'rejected', propose: 'hr_relay', relay: 'employee_review', return: 'hierarchy_review', negotiate: 'negotiation_hr', forward_negotiation: 'hierarchy_review', accept: 'accepted', withdraw: 'withdrawn' }
  update.status = next[input.action]
  if (input.action === 'propose') {
    const days = input.noticeDays
    if (!Number.isInteger(days) || days < 0 || days > 365) throw failure('Notice period must be a whole number from 0 to 365 days')
    const date = input.noticeStartDate
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw failure('Choose a valid notice start date')
    const start = new Date(`${date}T00:00:00.000Z`)
    if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== date || start < new Date(record.createdAt.toISOString().slice(0, 10))) throw failure('Notice cannot start before the resignation submission date')
    const last = new Date(start.getTime() + days * 86400000)
    if (last.toISOString().slice(0, 10) < now.toISOString().slice(0, 10)) throw failure('Last working date cannot be in the past')
    update.proposal = { noticeDays: days, noticeStartDate: start, lastWorkingDate: last, reason: event.reason }
    Object.assign(event, update.proposal)
  }
  if (['accept', 'relay'].includes(input.action) && (!record.proposal?.lastWorkingDate || new Date(record.proposal.lastWorkingDate).toISOString().slice(0, 10) < now.toISOString().slice(0, 10))) throw failure('This proposal has expired. HR must request an updated notice period.')
  if (input.action === 'reject' || input.action === 'withdraw') update.active = false
  // Accepted remains active until the separate HR offboarding process is completed.
  return { update, event }
}

export async function resolveReviewers(models, employee, requesterId) {
  const departments = await models.Department.find({ _id: { $in: [employee.department, ...(employee.departments || [])].filter(Boolean) }, isActive: { $ne: false } }).select('head heads departmentManager departmentManagers').lean()
  const employeeIds = [employee.reportingManager, employee.assignedManager, employee.assignedTeamLead, employee.reportsTo, ...departments.flatMap(d => [d.head, ...(d.heads || []), d.departmentManager, ...(d.departmentManagers || [])])].map(idOf).filter(id => id && id !== idOf(employee._id))
  const users = await models.User.find({ employeeId: { $in: [...new Set(employeeIds)] }, isActive: { $ne: false }, _id: { $ne: requesterId } }).select('_id').lean()
  return users.map(u => u._id)
}

export async function notifyResignation(models, record, hrUsers) {
  const targets = ['accepted', 'rejected', 'withdrawn'].includes(record.status) ? [...hrUsers, ...record.reviewers] : ['hr_review', 'hr_relay', 'negotiation_hr'].includes(record.status) ? hrUsers : record.status === 'hierarchy_review' ? record.reviewers : []
  const ids = [...new Set([...targets, record.requestedBy].map(idOf))]
  const messages = { hr_review: 'Resignation submitted for HR review.', hierarchy_review: 'Resignation needs a notice-period proposal from the assigned hierarchy.', hr_relay: 'Notice-period proposal awaits HR review and relay.', employee_review: 'HR has shared a notice-period proposal. Accept it or request a revision with a reason.', negotiation_hr: 'Employee requested a notice-period revision. HR review is required.', accepted: 'Employee accepted the notice period. HR can proceed with offboarding.', rejected: 'HR declined the resignation request. Review the reason in the timeline.', withdrawn: 'Employee withdrew the resignation request.' }
  const results = await Promise.allSettled(ids.map(user => models.Notification.create({ user, title: 'Resignation update', message: messages[record.status] || 'Exit finalised. HR has issued the settlement documents.', type: 'resignation', link: `/dashboard/resignations?resignation=${record._id}`, metadata: { resignationId: idOf(record._id) } })))
  return results.some(r => r.status === 'rejected')
}
