export const APPRAISAL_TIER = Object.freeze({
  team_leader: 0,
  manager: 1,
  department_head: 2,
  hr: 3,
})

const MAX_POINTERS = 12
const MAX_REVIEW_PERIOD_LENGTH = 80
const MAX_REASON_LENGTH = 4000
const MAX_POINTER_LENGTH = 500

export function isValidAppraisalObjectId(value) {
  return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value)
}

export function objectIdString(value) {
  const id = value?._id || value?.id || value
  return id?.toString?.() || (id ? String(id) : '')
}

export function getRequesterTier({ role, isDepartmentHead, isDepartmentManager, teamLeaderOf } = {}) {
  if (['admin', 'super_admin', 'hr'].includes(role)) return APPRAISAL_TIER.hr
  if (role === 'department_head' || isDepartmentHead) return APPRAISAL_TIER.department_head
  if (role === 'manager' || isDepartmentManager) return APPRAISAL_TIER.manager
  if (role === 'team_leader' || teamLeaderOf?.length) return APPRAISAL_TIER.team_leader
  return null
}

export function validateAppraisalRequest(input = {}) {
  const reviewPeriod = String(input.reviewPeriod || '').trim()
  if (!reviewPeriod) throw new Error('Review period is required')
  if (reviewPeriod.length > MAX_REVIEW_PERIOD_LENGTH) throw new Error('Review period must be 80 characters or fewer')

  if (input.proposedIncreasePercent === undefined || String(input.proposedIncreasePercent).trim() === '') {
    throw new Error('Proposed appraisal percentage is required')
  }
  const proposedIncreasePercent = Number(input.proposedIncreasePercent)
  if (!Number.isFinite(proposedIncreasePercent) || proposedIncreasePercent < 0 || proposedIncreasePercent > 100) {
    throw new Error('Proposed appraisal percentage must be between 0 and 100')
  }

  const reason = String(input.reason || '').trim()
  if (reason.length < 10) throw new Error('Please provide a clear reason (at least 10 characters)')
  if (reason.length > MAX_REASON_LENGTH) throw new Error('Reason must be 4000 characters or fewer')

  const rawPointers = Array.isArray(input.pointers)
    ? input.pointers
    : String(input.pointers || '').split(/\r?\n/)
  if (rawPointers.length > MAX_POINTERS) throw new Error(`Add no more than ${MAX_POINTERS} supporting pointers`)
  const pointers = rawPointers
    .map((pointer) => String(pointer || '').trim())
    .filter(Boolean)
  if (pointers.some((pointer) => pointer.length > MAX_POINTER_LENGTH)) {
    throw new Error('Each supporting pointer must be 500 characters or fewer')
  }
  if (pointers.length === 0) throw new Error('Add at least one supporting performance pointer')

  return { reviewPeriod, proposedIncreasePercent: Math.round(proposedIncreasePercent * 100) / 100, reason, pointers }
}

function userForEmployee(users, employeeId) {
  const employeeKey = objectIdString(employeeId)
  return users.find((user) => objectIdString(user.employeeId) === employeeKey && user.isActive !== false)
}

export function buildAppraisalApprovalChain({
  employee = {},
  departmentHeadEmployeeIds = [],
  users = [],
  requesterTier,
  requesterEmployeeId,
} = {}) {
  const requesterEmployee = objectIdString(requesterEmployeeId)
  const candidates = []
  const add = (employeeId, role) => {
    const id = objectIdString(employeeId)
    if (!id || id === objectIdString(employee._id) || id === requesterEmployee || APPRAISAL_TIER[role] <= requesterTier) return
    const existing = candidates.find((candidate) => candidate.employeeId === id)
    if (existing) {
      if (!existing.coveredRoles.includes(role)) existing.coveredRoles.push(role)
      if (APPRAISAL_TIER[role] > APPRAISAL_TIER[existing.role]) existing.role = role
      return
    }
    candidates.push({ employeeId: id, role, coveredRoles: [role] })
  }

  add(employee.assignedTeamLead, 'team_leader')
  add(employee.assignedManager || employee.reportingManager, 'manager')

  const headCandidates = [...new Set((departmentHeadEmployeeIds || []).map(objectIdString).filter(Boolean))]
    .filter((id) => id !== requesterEmployee && id !== objectIdString(employee._id))
  const activeHeadId = headCandidates.find((id) => userForEmployee(users, id))
  if (activeHeadId) add(activeHeadId, 'department_head')

  const resolved = candidates.map((candidate) => {
    const user = userForEmployee(users, candidate.employeeId)
    if (!user) {
      const label = candidate.role.replace('_', ' ')
      throw new Error(`An active ${label} account is required to route this appraisal`)
    }
    return {
      role: candidate.role,
      coveredRoles: candidate.coveredRoles,
      approverUser: objectIdString(user._id),
      approverEmployee: candidate.employeeId,
    }
  })

  if (requesterTier <= APPRAISAL_TIER.team_leader && !resolved.some((step) => step.coveredRoles.includes('manager'))) {
    throw new Error('Assign an active manager to this employee before submitting the appraisal')
  }
  if (requesterTier <= APPRAISAL_TIER.manager && !resolved.some((step) => step.coveredRoles.includes('department_head'))) {
    throw new Error('Assign an active department head to this employee before submitting the appraisal')
  }

  return resolved
}

export function appendHrReviewStep(approvalSteps, hrApproverUserIds) {
  const existingSteps = Array.isArray(approvalSteps) ? approvalSteps : []
  const alreadyAssigned = new Set(existingSteps.flatMap((step) => [
    step.approverUser,
    ...(step.approverUsers || []),
  ]).map(objectIdString).filter(Boolean))
  const approverUsers = [...new Set((hrApproverUserIds || []).map(objectIdString).filter(Boolean))]
    .filter((id) => !alreadyAssigned.has(id))
  if (!approverUsers.length) throw new Error('No independent HR reviewer account is configured for the final discussion')
  return [...existingSteps, { role: 'hr', approverUsers, status: 'pending' }]
}

export function canActOnAppraisal(appraisal, user) {
  const step = appraisal?.approvalSteps?.[appraisal?.currentStepIndex]
  if (!step || step.status !== 'pending') return false
  const userId = objectIdString(user?._id || user?.userId)
  if (step.role === 'hr') {
    return (step.approverUsers || []).some((id) => objectIdString(id) === userId)
  }
  return objectIdString(step.approverUser) === userId
}

export function transitionAppraisal({ appraisal, action, outcome, comment, actorId, actorRole, now = new Date() }) {
  const index = appraisal?.currentStepIndex
  const current = appraisal?.approvalSteps?.[index]
  if (!current || current.status !== 'pending') throw new Error('This appraisal step is no longer pending')

  const note = String(comment || '').trim()
  if (note.length > 2000) throw new Error('Comments must be 2000 characters or fewer')
  if (action === 'reject' && !note) throw new Error('A reason is required to reject this appraisal')
  if (action === 'complete_discussion') {
    if (current.role !== 'hr') throw new Error('Only HR can complete the discussion')
    if (!['approved', 'rejected'].includes(outcome)) throw new Error('Choose an HR discussion outcome')
    if (note.length < 5) throw new Error('Add the HR discussion notes before completing this request')
  } else if (!['approve', 'reject'].includes(action)) {
    throw new Error('Unsupported appraisal action')
  }

  const approvalSteps = appraisal.approvalSteps.map((step, stepIndex) => (
    stepIndex === index
      ? { ...step, status: action === 'reject' || outcome === 'rejected' ? 'rejected' : 'approved', comment: note, actedBy: actorId, actedAt: now }
      : step
  ))
  const timelineType = action === 'complete_discussion'
    ? 'hr_discussion_completed'
    : action === 'reject' ? 'rejected' : 'approved'
  const timelineEvent = { type: timelineType, actor: actorId, role: actorRole, message: note, at: now }

  if (action === 'reject') return { status: 'rejected', currentStepIndex: index, approvalSteps, timelineEvent }
  if (action === 'complete_discussion') {
    return {
      status: outcome,
      currentStepIndex: index,
      approvalSteps,
      hrDiscussion: { notes: note, outcome, completedBy: actorId, completedAt: now },
      timelineEvent,
    }
  }

  const nextStepIndex = index + 1
  const nextStep = appraisal.approvalSteps[nextStepIndex]
  if (!nextStep) return { status: 'approved', currentStepIndex: index, approvalSteps, timelineEvent }
  return {
    status: nextStep.role === 'hr' ? 'hr_discussion' : 'pending_approval',
    currentStepIndex: nextStepIndex,
    approvalSteps,
    timelineEvent,
  }
}

export async function notifyAppraisalUsers(models, userIds, { title, message, appraisalId, employeeId } = {}) {
  if (!models?.Notification || !Array.isArray(userIds) || userIds.length === 0) return
  const link = `/dashboard/performance/appraisals?request=${encodeURIComponent(String(appraisalId || ''))}`
  const uniqueIds = [...new Set(userIds.map(objectIdString).filter(Boolean))]
  const results = await Promise.allSettled(uniqueIds.map((user) => models.Notification.create({
    user,
    title,
    message,
    type: 'performance_appraisal',
    link,
    metadata: { appraisalId: String(appraisalId || ''), employeeId: String(employeeId || '') },
  })))
  results.forEach((result) => {
    if (result.status === 'rejected') console.error('[Performance Appraisal] Notification failed:', result.reason?.message)
  })
}
