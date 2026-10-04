import { apiError, apiSuccess, withTenantApi } from '@/lib/api/route'
import { checkTenantFeatureAccess } from '@/lib/companyFeatures.server'
import { sanitizeWorkflowData, validateWorkflowPayload } from '@/lib/hrms/workflowService.server'

import { randomBytes } from 'node:crypto'
import { getWorkflowStore, canReadWorkflow, populateWorkflow } from '@/lib/hrms/workflowStore.server'
import { workflowSearchGrams } from '@/lib/hrms/workflowSearch'

export const dynamic = 'force-dynamic'

function canEdit(user, workflow) {
  if (['admin', 'hr', 'manager', 'department_head'].includes(user.role)) return true
  const userId = String(user.id || user._id)
  return userId === String(workflow.owner) || userId === String(workflow.createdBy)
}

export const GET = withTenantApi({
  firestore: {},
  errorMessage: 'Failed to load HRMS workflow',
}, async ({ context, auth }) => {
  const { id } = await context.params
  if (!/^[a-f\d]{24}$/i.test(id || '')) return apiError('Invalid workflow ID', { status: 400 })
  const database = await getWorkflowStore(auth)
  const current = await database.get('hrmsworkflows', id)
  if (!current || !canReadWorkflow(auth.user, current)) return apiError('Workflow not found', { status: 404, code: 'NOT_FOUND' })
  const workflow = await populateWorkflow(database, current, true)

  const access = await checkTenantFeatureAccess(auth, { allOf: [workflow.module] })
  if (!access.success) return apiError(access.message, { status: access.status, code: access.code })
  const events = []; let cursor
  do {
    const page = await database.list('hrmsworkflowevents', { filters: [{ field: 'workflow', operator: '==', value: id }], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 100, cursor })
    events.push(...await Promise.all(page.records.map(async event => { const actor = event.actor ? await database.get('users', String(event.actor)) : null; return { ...event, actor: actor ? { _id: actor._id, email: actor.email, role: actor.role, employeeId: actor.employeeId } : null } })))
    cursor = page.nextCursor
  } while (cursor)
  return apiSuccess({ workflow, events })
})

export const PATCH = withTenantApi({
  firestore: {},
  errorMessage: 'Failed to update HRMS workflow',
}, async ({ request, context, auth }) => {
  const { id } = await context.params
  if (!/^[a-f\d]{24}$/i.test(id || '')) return apiError('Invalid workflow ID', { status: 400 })
  const database = await getWorkflowStore(auth)
  const existing = await database.get('hrmsworkflows', id)
  if (!existing || !canReadWorkflow(auth.user, existing)) return apiError('Workflow not found', { status: 404, code: 'NOT_FOUND' })
  if (!['draft', 'rejected'].includes(existing.status)) {
    return apiError('Only draft or rejected workflows can be edited', { status: 409, code: 'INVALID_STATE' })
  }
  if (!canEdit(auth.user, existing)) return apiError('You cannot edit this workflow', { status: 403, code: 'FORBIDDEN' })

  const access = await checkTenantFeatureAccess(auth, { allOf: [existing.module] })
  if (!access.success) return apiError(access.message, { status: access.status, code: access.code })
  const body = await request.json()
  const errors = validateWorkflowPayload(body, { partial: true })
  if (errors.length) return apiError('Workflow validation failed', { status: 400, code: 'VALIDATION_ERROR', details: { errors } })

  const allowed = {}
  for (const key of ['title', 'description', 'subjectEmployee', 'owner', 'assignees', 'dueAt', 'priority']) {
    if (body[key] !== undefined) allowed[key] = body[key]
  }
  if (body.data !== undefined) allowed.data = sanitizeWorkflowData(body.data)
  allowed.updatedBy = auth.user.id || auth.user._id
  const workflow = await database.transaction(async tx => {
    const latest = await tx.get('hrmsworkflows', id)
    if (!latest || latest.version !== existing.version || latest.status !== existing.status) return null
    const now = new Date()
    const updated = { ...latest, ...allowed, version: Number(latest.version || 0) + 1, updatedAt: now }
    updated.searchGrams = workflowSearchGrams(updated)
    await tx.replace('hrmsworkflows', updated)
    await tx.create('hrmsworkflowevents', { _id: randomBytes(12).toString('hex'), workflow: updated._id, module: updated.module, type: 'updated', actor: auth.user.id || auth.user._id, metadata: { fields: Object.keys(allowed).filter(key => key !== 'updatedBy') }, createdAt: now, updatedAt: now })
    return updated
  })
  if (!workflow) return apiError('Workflow changed; refresh and retry', { status: 409, code: 'VERSION_CONFLICT' })
  return apiSuccess(workflow, { message: 'Workflow updated' })
})
