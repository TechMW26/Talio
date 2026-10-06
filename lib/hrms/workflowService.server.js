import crypto from 'crypto'
import { workflowSearchGrams } from './workflowSearch'
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

function createCaseNumber(module) {
  const prefix = module.replace(/[^A-Z]/gi, '').slice(0, 5).toUpperCase()
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `${prefix}-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
}

export async function createWorkflow({ database, actor, payload, allowIncompleteData = false, bypassPermission = false }) {
  const errors = validateWorkflowPayload(payload, { skipRequiredData: allowIncompleteData })
  if (errors.length) return { success: false, status: 400, code: 'VALIDATION_ERROR', errors }
  if (!bypassPermission && !canCreateWorkflow(actor.role, payload.module)) {
    return { success: false, status: 403, code: 'FORBIDDEN', message: 'You cannot create this workflow module' }
  }

  const actorId = actor.id || actor._id
  const data = sanitizeWorkflowData(payload.data || {})
  const now = new Date()
  const workflowPayload = {
    _id: payload.idempotencyKey ? crypto.createHash('sha256').update(`workflow:${payload.idempotencyKey}`).digest('hex').slice(0, 24) : crypto.randomBytes(12).toString('hex'),
    status: 'draft', version: 0, linkedCases: [], createdAt: now, updatedAt: now,
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

  workflowPayload.searchGrams = workflowSearchGrams(workflowPayload)
  if (payload.idempotencyKey) {
    const existing = await database.list('hrmsworkflows', { filters: [{ field: 'idempotencyKey', operator: '==', value: payload.idempotencyKey }], limit: 1 })
    if (existing.records[0]) return { success: true, workflow: existing.records[0], deduplicated: true }
  }
  return database.transaction(async tx => {
    const current = await tx.get('hrmsworkflows', workflowPayload._id)
    if (current && payload.idempotencyKey) return { success: true, workflow: current, deduplicated: true }
    await tx.create('hrmsworkflows', workflowPayload)
    await tx.create('hrmsworkflowevents', { _id: crypto.randomBytes(12).toString('hex'), workflow: workflowPayload._id, module: workflowPayload.module, type: 'created', toStatus: workflowPayload.status, actor: actorId, metadata: { caseNumber: workflowPayload.caseNumber }, createdAt: now, updatedAt: now })
    return { success: true, workflow: workflowPayload }
  })
}

export async function transitionWorkflow({ database, workflow, actor, action, comment }) {
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
  return database.transaction(async tx => {
    const latest = await tx.get('hrmsworkflows', String(workflow._id))
    if (!latest || latest.version !== workflow.version || latest.status !== workflow.status) return { success: false, status: 409, code: 'VERSION_CONFLICT', message: 'Workflow changed; refresh and retry' }
    const updated = { ...latest, ...updates, version: Number(latest.version || 0) + 1, updatedAt: now }
    await tx.replace('hrmsworkflows', updated)
    await tx.create('hrmsworkflowevents', { _id: crypto.randomBytes(12).toString('hex'), workflow: updated._id, module: updated.module, type: action, fromStatus: latest.status, toStatus: updated.status, actor: actorId, comment: String(comment || '').trim(), createdAt: now, updatedAt: now })
    return { success: true, workflow: updated }
  })
}

export async function advanceWorkflow({ database, workflow, actor, comment }) {
  if (!PRIVILEGED_ROLES.has(actor.role)) {
    return { success: false, status: 403, code: 'FORBIDDEN', message: 'Advancing the employee lifecycle requires HR or manager access' }
  }
  let completed = workflow
  if (workflow.status !== 'completed') {
    const action = workflow.status === 'approved' || workflow.status === 'in_progress' ? 'complete' : null
    if (!action) {
      return { success: false, status: 409, code: 'INVALID_TRANSITION', message: 'Approve the workflow before advancing it' }
    }
    const result = await transitionWorkflow({ database, workflow, actor, action, comment })
    if (!result.success) return result
    completed = result.workflow
  }

  const nextModule = getNextHrmsModule(completed.module)
  if (!nextModule) return { success: true, workflow: completed, nextWorkflow: null }

  const idempotencyKey = `advance:${completed._id}:${nextModule}`
  let nextWorkflow = (await database.list('hrmsworkflows', { filters: [{ field: 'idempotencyKey', operator: '==', value: idempotencyKey }], limit: 1 })).records[0]
  if (!nextWorkflow) {
    const nextResult = await createWorkflow({
      database,
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

  await database.mutate('hrmsworkflows', String(completed._id), current => ({ ...current, linkedCases: [...new Set([...(current.linkedCases || []).map(String), String(nextWorkflow._id)])], updatedAt: new Date() }))
  return { success: true, workflow: completed, nextWorkflow }
}
