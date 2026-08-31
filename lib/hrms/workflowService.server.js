import crypto from 'crypto'
import { HRMS_MODULE_BY_KEY, HRMS_MODULE_FIELDS, getNextHrmsModule } from '@/lib/hrms/moduleRegistry'

const PRIVILEGED_ROLES = new Set(['admin', 'hr', 'manager', 'department_head', 'superadmin'])
const EMPLOYEE_CREATABLE_MODULES = new Set(['leaveManagement', 'travel', 'helpdesk', 'posh', 'documents'])
const CONFIDENTIAL_MODULES = new Set(['posh', 'disciplinary'])

const ACTION_TRANSITIONS = {
  submit: { from: ['draft', 'rejected'], to: 'submitted' },
  approve: { from: ['submitted'], to: 'approved', privileged: true },
  reject: { from: ['submitted'], to: 'rejected', privileged: true, commentRequired: true },
  start: { from: ['approved'], to: 'in_progress', privileged: true },
  complete: { from: ['approved', 'in_progress'], to: 'completed', privileged: true },
  cancel: { from: ['draft', 'submitted', 'approved', 'rejected', 'in_progress'], to: 'cancelled' },
  reopen: { from: ['cancelled'], to: 'draft', privileged: true },
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

export function sanitizeWorkflowData(input, depth = 0) {
  if (depth > 6) throw new Error('Workflow data is too deeply nested')
  if (input === null || ['string', 'number', 'boolean'].includes(typeof input)) return input
  if (input instanceof Date) return input
  if (Array.isArray(input)) return input.slice(0, 200).map((value) => sanitizeWorkflowData(value, depth + 1))
  if (typeof input !== 'object') return undefined

  const clean = {}
  for (const [key, value] of Object.entries(input).slice(0, 200)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) continue
    const sanitized = sanitizeWorkflowData(value, depth + 1)
    if (sanitized !== undefined) clean[key] = sanitized
  }
  return clean
}

export function validateWorkflowPayload(payload, { partial = false, skipRequiredData = false } = {}) {
  const errors = []
  if (!partial || payload.module !== undefined) {
    if (!HRMS_MODULE_BY_KEY[payload.module]) errors.push({ field: 'module', message: 'Unknown HRMS module' })
  }
  if (!partial || payload.title !== undefined) {
    const title = String(payload.title || '').trim()
    if (!title) errors.push({ field: 'title', message: 'Title is required' })
    if (title.length > 200) errors.push({ field: 'title', message: 'Title must be 200 characters or fewer' })
  }

  if (!partial && !skipRequiredData && HRMS_MODULE_BY_KEY[payload.module]) {
    for (const field of HRMS_MODULE_FIELDS[payload.module] || []) {
      if (!hasOwn(payload.data || {}, field) || payload.data[field] === '' || payload.data[field] === null) {
        errors.push({ field: `data.${field}`, message: `${field} is required` })
      }
    }
  }
  return errors
}

export function canCreateWorkflow(role, module) {
  return PRIVILEGED_ROLES.has(role) || EMPLOYEE_CREATABLE_MODULES.has(module)
}

export function buildWorkflowVisibilityFilter(user) {
  if (['admin', 'hr', 'superadmin'].includes(user?.role)) return {}
  const userId = user?.id || user?._id
  const access = [{ owner: userId }, { createdBy: userId }, { assignees: userId }]
  if (user?.employeeId) access.push({ subjectEmployee: user.employeeId })
  if (['manager', 'department_head'].includes(user?.role)) {
    return { $or: [{ confidential: { $ne: true } }, ...access] }
  }
  return { $or: access }
}

function createCaseNumber(module) {
  const prefix = module.replace(/[^A-Z]/gi, '').slice(0, 5).toUpperCase()
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `${prefix}-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
}

export async function createWorkflow({ Workflow, Event, actor, payload, allowIncompleteData = false, bypassPermission = false }) {
  const errors = validateWorkflowPayload(payload, { skipRequiredData: allowIncompleteData })
  if (errors.length) return { success: false, status: 400, code: 'VALIDATION_ERROR', errors }
  if (!bypassPermission && !canCreateWorkflow(actor.role, payload.module)) {
    return { success: false, status: 403, code: 'FORBIDDEN', message: 'You cannot create this workflow module' }
  }

  const actorId = actor.id || actor._id
  const data = sanitizeWorkflowData(payload.data || {})
  const workflowPayload = {
    caseNumber: createCaseNumber(payload.module),
    module: payload.module,
    title: String(payload.title).trim(),
    description: String(payload.description || '').trim(),
    subjectEmployee: payload.subjectEmployee || actor.employeeId || null,
    owner: payload.owner || actorId,
    assignees: Array.isArray(payload.assignees) ? payload.assignees.slice(0, 50) : [],
    dueAt: payload.dueAt || null,
    priority: payload.priority || 'medium',
    confidential: CONFIDENTIAL_MODULES.has(payload.module) || payload.confidential === true,
    data,
    source: payload.source || undefined,
    approvals: Array.isArray(payload.approvals) ? payload.approvals.slice(0, 10) : [],
    idempotencyKey: payload.idempotencyKey || undefined,
    createdBy: actorId,
    updatedBy: actorId,
  }

  let workflow
  try {
    workflow = await Workflow.create(workflowPayload)
  } catch (error) {
    if (error?.code === 11000 && payload.idempotencyKey) {
      workflow = await Workflow.findOne({ idempotencyKey: payload.idempotencyKey })
      return { success: true, workflow, deduplicated: true }
    }
    throw error
  }

  await Event.create({
    workflow: workflow._id,
    module: workflow.module,
    type: 'created',
    toStatus: workflow.status,
    actor: actorId,
    metadata: { caseNumber: workflow.caseNumber },
  })
  return { success: true, workflow }
}

export async function transitionWorkflow({ Workflow, Event, workflow, actor, action, comment }) {
  const transition = ACTION_TRANSITIONS[action]
  if (!transition) return { success: false, status: 400, code: 'INVALID_ACTION', message: 'Unsupported workflow action' }
  if (!transition.from.includes(workflow.status)) {
    return { success: false, status: 409, code: 'INVALID_TRANSITION', message: `Cannot ${action} a ${workflow.status} workflow` }
  }
  if (transition.privileged && !PRIVILEGED_ROLES.has(actor.role)) {
    return { success: false, status: 403, code: 'FORBIDDEN', message: 'This action requires HR or manager access' }
  }
  if (transition.commentRequired && !String(comment || '').trim()) {
    return { success: false, status: 400, code: 'COMMENT_REQUIRED', message: 'A comment is required' }
  }

  const actorId = actor.id || actor._id
  const now = new Date()
  const updates = {
    status: transition.to,
    updatedBy: actorId,
    ...(transition.to === 'completed' ? { completedAt: now } : {}),
    ...(transition.to === 'cancelled' ? { cancelledAt: now } : {}),
    ...(transition.to === 'draft' ? { cancelledAt: null, completedAt: null } : {}),
  }
  const updated = await Workflow.findOneAndUpdate(
    { _id: workflow._id, version: workflow.version },
    { $set: updates, $inc: { version: 1 } },
    { new: true },
  )
  if (!updated) {
    return { success: false, status: 409, code: 'VERSION_CONFLICT', message: 'Workflow changed; refresh and retry' }
  }

  await Event.create({
    workflow: updated._id,
    module: updated.module,
    type: action,
    fromStatus: workflow.status,
    toStatus: updated.status,
    actor: actorId,
    comment: String(comment || '').trim(),
  })
  return { success: true, workflow: updated }
}

export async function advanceWorkflow({ Workflow, Event, workflow, actor, comment }) {
  if (!PRIVILEGED_ROLES.has(actor.role)) {
    return { success: false, status: 403, code: 'FORBIDDEN', message: 'Advancing the employee lifecycle requires HR or manager access' }
  }
  let completed = workflow
  if (workflow.status !== 'completed') {
    const action = workflow.status === 'approved' || workflow.status === 'in_progress' ? 'complete' : null
    if (!action) {
      return { success: false, status: 409, code: 'INVALID_TRANSITION', message: 'Approve the workflow before advancing it' }
    }
    const result = await transitionWorkflow({ Workflow, Event, workflow, actor, action, comment })
    if (!result.success) return result
    completed = result.workflow
  }

  const nextModule = getNextHrmsModule(completed.module)
  if (!nextModule) return { success: true, workflow: completed, nextWorkflow: null }

  const idempotencyKey = `advance:${completed._id}:${nextModule}`
  let nextWorkflow = await Workflow.findOne({ idempotencyKey })
  if (!nextWorkflow) {
    const nextResult = await createWorkflow({
      Workflow,
      Event,
      actor,
      payload: {
        module: nextModule,
        title: `${HRMS_MODULE_BY_KEY[nextModule].label}: ${completed.title}`,
        description: `Created from ${completed.caseNumber}`,
        subjectEmployee: completed.subjectEmployee,
        owner: completed.owner,
        assignees: completed.assignees,
        data: { ...completed.data, upstreamCaseNumber: completed.caseNumber },
        source: { module: completed.module, caseId: completed._id },
        idempotencyKey,
      },
      allowIncompleteData: true,
      bypassPermission: true,
    })
    if (!nextResult.success) return nextResult
    nextWorkflow = nextResult.workflow
  }

  await Workflow.updateOne({ _id: completed._id }, { $addToSet: { linkedCases: nextWorkflow._id } })
  return { success: true, workflow: completed, nextWorkflow }
}
