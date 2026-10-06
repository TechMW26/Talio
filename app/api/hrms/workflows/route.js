import { apiError, apiSuccess, getPagination, withTenantApi } from '@/lib/api/route'
import { checkTenantFeatureAccess } from '@/lib/companyFeatures.server'
import { HRMS_MODULE_KEYS } from '@/lib/hrms/moduleRegistry'
import {
  createWorkflow,
} from '@/lib/hrms/workflowService.server'
import { getWorkflowStore, listVisibleWorkflows, populateWorkflow } from '@/lib/hrms/workflowStore.server'

const WORKFLOW_STATUSES = new Set(['draft', 'submitted', 'approved', 'rejected', 'in_progress', 'completed', 'cancelled'])

export const dynamic = 'force-dynamic'

export const GET = withTenantApi({
  firestore: {},
  features: { anyOf: HRMS_MODULE_KEYS },
  errorMessage: 'Failed to load HRMS workflows',
}, async ({ request, auth }) => {
  const { searchParams } = new URL(request.url)
  const { page, limit, skip } = getPagination(searchParams)
  const requestedModule = searchParams.get('module')
  if (requestedModule && !HRMS_MODULE_KEYS.includes(requestedModule)) {
    return apiError('Unknown HRMS module', { status: 400, code: 'VALIDATION_ERROR' })
  }

  const enabledModules = HRMS_MODULE_KEYS.filter((key) => auth.companyFeatures[key] === true)
  if (requestedModule && !enabledModules.includes(requestedModule)) return apiError('This workflow module is disabled', { status: 403, code: 'FEATURE_DISABLED' })
  const database = await getWorkflowStore(auth)
  const status = searchParams.get('status')
  if (status && !WORKFLOW_STATUSES.has(status)) {
    return apiError('Unknown workflow status', { status: 400, code: 'VALIDATION_ERROR' })
  }
  const search = String(searchParams.get('q') || '').trim().slice(0, 100)
  const matches = await listVisibleWorkflows(database, auth.user, { modules: requestedModule ? [requestedModule] : enabledModules, status, search })
  const total = matches.length
  const items = await Promise.all(matches.slice(skip, skip + limit).map(workflow => populateWorkflow(database, workflow)))

  return apiSuccess(items, { meta: { page, limit, total, pages: Math.ceil(total / limit) } })
})

export const POST = withTenantApi({
  firestore: {},
  errorMessage: 'Failed to create HRMS workflow',
}, async ({ request, auth }) => {
  const body = await request.json()
  if (!HRMS_MODULE_KEYS.includes(body.module)) {
    return apiError('Unknown HRMS module', { status: 400, code: 'VALIDATION_ERROR' })
  }
  const access = await checkTenantFeatureAccess(auth, { allOf: [body.module] })
  if (!access.success) return apiError(access.message, { status: access.status, code: access.code })

  const result = await createWorkflow({
    database: await getWorkflowStore(auth),
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
