import { apiError, apiSuccess, getPagination, withTenantApi } from '@/lib/api/route'
import { checkTenantFeatureAccess } from '@/lib/companyFeatures.server'
import { HRMS_MODULE_KEYS } from '@/lib/hrms/moduleRegistry'
import {
  buildWorkflowVisibilityFilter,
  createWorkflow,
} from '@/lib/hrms/workflowService.server'

const WORKFLOW_STATUSES = new Set(['draft', 'submitted', 'approved', 'rejected', 'in_progress', 'completed', 'cancelled'])

export const dynamic = 'force-dynamic'

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const GET = withTenantApi({
  models: ['HrmsWorkflow', 'HrmsWorkflowEvent', 'User', 'Employee'],
  features: { anyOf: HRMS_MODULE_KEYS },
  errorMessage: 'Failed to load HRMS workflows',
}, async ({ request, auth, models }) => {
  const { searchParams } = new URL(request.url)
  const { page, limit, skip } = getPagination(searchParams)
  const requestedModule = searchParams.get('module')
  if (requestedModule && !HRMS_MODULE_KEYS.includes(requestedModule)) {
    return apiError('Unknown HRMS module', { status: 400, code: 'VALIDATION_ERROR' })
  }

  const enabledModules = HRMS_MODULE_KEYS.filter((key) => auth.companyFeatures[key] === true)
  const query = {
    ...buildWorkflowVisibilityFilter(auth.user),
    module: requestedModule || { $in: enabledModules },
  }
  const status = searchParams.get('status')
  if (status && !WORKFLOW_STATUSES.has(status)) {
    return apiError('Unknown workflow status', { status: 400, code: 'VALIDATION_ERROR' })
  }
  if (status) query.status = status
  const search = String(searchParams.get('q') || '').trim().slice(0, 100)
  if (search) {
    const matcher = { $regex: escapeRegex(search), $options: 'i' }
    query.$and = [...(query.$and || []), { $or: [{ title: matcher }, { caseNumber: matcher }] }]
  }

  const [items, total] = await Promise.all([
    models.HrmsWorkflow.find(query)
      .populate('subjectEmployee', 'firstName lastName employeeCode profilePicture')
      .populate('owner', 'email role employeeId')
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    models.HrmsWorkflow.countDocuments(query),
  ])

  return apiSuccess(items, { meta: { page, limit, total, pages: Math.ceil(total / limit) } })
})

export const POST = withTenantApi({
  models: ['HrmsWorkflow', 'HrmsWorkflowEvent', 'User', 'Employee'],
  errorMessage: 'Failed to create HRMS workflow',
}, async ({ request, auth, models }) => {
  const body = await request.json()
  if (!HRMS_MODULE_KEYS.includes(body.module)) {
    return apiError('Unknown HRMS module', { status: 400, code: 'VALIDATION_ERROR' })
  }
  const access = await checkTenantFeatureAccess(auth, { allOf: [body.module] })
  if (!access.success) return apiError(access.message, { status: access.status, code: access.code })

  const result = await createWorkflow({
    Workflow: models.HrmsWorkflow,
    Event: models.HrmsWorkflowEvent,
    actor: auth.user,
    payload: body,
  })
  if (!result.success) {
    return apiError(result.message || 'Workflow validation failed', {
      status: result.status,
      code: result.code,
      details: result.errors ? { errors: result.errors } : undefined,
    })
  }
  return apiSuccess(result.workflow, {
    status: result.deduplicated ? 200 : 201,
    message: result.deduplicated ? 'Existing workflow returned' : 'Workflow created',
  })
})
