import { apiError, apiSuccess, withTenantApi } from '@/lib/api/route'
import { checkTenantFeatureAccess } from '@/lib/companyFeatures.server'
import { advanceWorkflow, buildWorkflowVisibilityFilter, transitionWorkflow } from '@/lib/hrms/workflowService.server'
import { getNextHrmsModule } from '@/lib/hrms/moduleRegistry'

export const POST = withTenantApi({
  models: ['HrmsWorkflow', 'HrmsWorkflowEvent', 'User', 'Employee'],
  errorMessage: 'Failed to transition HRMS workflow',
}, async ({ request, context, auth, models }) => {
  const { id } = await context.params
  if (!models.HrmsWorkflow.db.base.Types.ObjectId.isValid(id)) {
    return apiError('Invalid workflow ID', { status: 400, code: 'VALIDATION_ERROR' })
  }
  const workflow = await models.HrmsWorkflow.findOne({ _id: id, ...buildWorkflowVisibilityFilter(auth.user) })
  if (!workflow) return apiError('Workflow not found', { status: 404, code: 'NOT_FOUND' })

  const access = await checkTenantFeatureAccess(auth, { allOf: [workflow.module] })
  if (!access.success) return apiError(access.message, { status: access.status, code: access.code })
  const body = await request.json()
  if (body.action === 'advance') {
    const nextModule = getNextHrmsModule(workflow.module)
    if (nextModule) {
      const nextAccess = await checkTenantFeatureAccess(auth, { allOf: [nextModule] })
      if (!nextAccess.success) {
        return apiError('The next workflow module is disabled for this company', {
          status: 409,
          code: 'NEXT_FEATURE_DISABLED',
          details: { nextModule },
        })
      }
    }
  }
  const params = {
    Workflow: models.HrmsWorkflow,
    Event: models.HrmsWorkflowEvent,
    workflow,
    actor: auth.user,
    comment: body.comment,
  }
  const result = body.action === 'advance'
    ? await advanceWorkflow(params)
    : await transitionWorkflow({ ...params, action: body.action })

  if (!result.success) return apiError(result.message, { status: result.status, code: result.code })
  return apiSuccess({ workflow: result.workflow, nextWorkflow: result.nextWorkflow || null }, { message: 'Workflow updated' })
})
