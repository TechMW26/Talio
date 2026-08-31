import { apiError, apiSuccess, withTenantApi } from '@/lib/api/route'
import { checkTenantFeatureAccess } from '@/lib/companyFeatures.server'
import { buildWorkflowVisibilityFilter, sanitizeWorkflowData, validateWorkflowPayload } from '@/lib/hrms/workflowService.server'

export const dynamic = 'force-dynamic'

function canEdit(user, workflow) {
  if (['admin', 'hr', 'manager', 'department_head'].includes(user.role)) return true
  const userId = String(user.id || user._id)
  return userId === String(workflow.owner) || userId === String(workflow.createdBy)
}

export const GET = withTenantApi({
  models: ['HrmsWorkflow', 'HrmsWorkflowEvent', 'User', 'Employee'],
  errorMessage: 'Failed to load HRMS workflow',
}, async ({ context, auth, models }) => {
  const { id } = await context.params
  const workflow = await models.HrmsWorkflow.findOne({ _id: id, ...buildWorkflowVisibilityFilter(auth.user) })
    .populate('subjectEmployee', 'firstName lastName employeeCode profilePicture')
    .populate('owner assignees createdBy updatedBy', 'email role employeeId')
    .lean()
  if (!workflow) return apiError('Workflow not found', { status: 404, code: 'NOT_FOUND' })

  const access = await checkTenantFeatureAccess(auth, { allOf: [workflow.module] })
  if (!access.success) return apiError(access.message, { status: access.status, code: access.code })
  const events = await models.HrmsWorkflowEvent.find({ workflow: workflow._id })
    .populate('actor', 'email role employeeId')
    .sort({ createdAt: -1 })
    .lean()
  return apiSuccess({ workflow, events })
})

export const PATCH = withTenantApi({
  models: ['HrmsWorkflow', 'HrmsWorkflowEvent', 'User', 'Employee'],
  errorMessage: 'Failed to update HRMS workflow',
}, async ({ request, context, auth, models }) => {
  const { id } = await context.params
  const existing = await models.HrmsWorkflow.findOne({ _id: id, ...buildWorkflowVisibilityFilter(auth.user) })
  if (!existing) return apiError('Workflow not found', { status: 404, code: 'NOT_FOUND' })
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
  const workflow = await models.HrmsWorkflow.findOneAndUpdate(
    { _id: existing._id, version: existing.version },
    { $set: allowed, $inc: { version: 1 } },
    { new: true },
  )
  if (!workflow) return apiError('Workflow changed; refresh and retry', { status: 409, code: 'VERSION_CONFLICT' })

  await models.HrmsWorkflowEvent.create({
    workflow: workflow._id,
    module: workflow.module,
    type: 'updated',
    actor: auth.user.id || auth.user._id,
    metadata: { fields: Object.keys(allowed).filter((key) => key !== 'updatedBy') },
  })
  return apiSuccess(workflow, { message: 'Workflow updated' })
})
