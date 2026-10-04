import { apiError, apiSuccess, withTenantApi } from '@/lib/api/route'
import { checkTenantFeatureAccess } from '@/lib/companyFeatures.server'
import { advanceWorkflow, transitionWorkflow } from '@/lib/hrms/workflowService.server'
import { getWorkflowStore, canReadWorkflow } from '@/lib/hrms/workflowStore.server'
import { getNextHrmsModule } from '@/lib/hrms/moduleRegistry'

export const POST = withTenantApi({
  firestore: {},
  errorMessage: 'Failed to transition HRMS workflow',
}, async ({ request, context, auth }) => {
  const { id } = await context.params
  if (!/^[a-f\d]{24}$/i.test(id || '')) {
    return apiError('Invalid workflow ID', { status: 400, code: 'VALIDATION_ERROR' })
  }
  const database = await getWorkflowStore(auth)
  const workflow = await database.get('hrmsworkflows', id)
  if (!workflow || !canReadWorkflow(auth.user, workflow)) return apiError('Workflow not found', { status: 404, code: 'NOT_FOUND' })

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
    database,
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
