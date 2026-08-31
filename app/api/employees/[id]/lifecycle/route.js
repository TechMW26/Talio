import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getAuthAndModels } from '@/lib/auth'
import { clearCachePattern, buildCachePattern } from '@/lib/cache'
import queryCache from '@/lib/queryCache'
import { isFeatureEnabled } from '@/lib/planFeatures'
import { applyLifecycleAction, getLifecycleProgress, hydrateEmployeeLifecycle, reconcileOnboardingChecklist } from '@/lib/hrms/employeeLifecycle.server'
import { getOnboardingCompletionSignals } from '@/lib/hrms/onboardingProgress.server'
import { createWorkflow } from '@/lib/hrms/workflowService.server'

export const dynamic = 'force-dynamic'

const MANAGER_ROLES = new Set(['admin', 'hr', 'manager', 'department_head', 'superadmin'])
const HR_ROLES = new Set(['admin', 'hr', 'superadmin'])

function moduleForAction(action) {
  if (action.includes('onboarding')) return 'onboarding'
  if (action.includes('probation')) return 'probation'
  return 'exitManagement'
}

function actorId(user) {
  return user?.id || user?._id
}

async function authorize(request, id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return { response: NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 }) }
  }
  const auth = await getAuthAndModels(request, ['Employee', 'HrmsWorkflow', 'HrmsWorkflowEvent', 'Document', 'Asset', 'Payroll', 'Policy'])
  if (!auth.success) {
    return { response: NextResponse.json({ success: false, message: auth.message || 'Unauthorized' }, { status: 401 }) }
  }
  return { auth }
}

async function getLifecycle(request, { params }) {
  const { id } = await params
  const { auth, response } = await authorize(request, id)
  if (response) return response

  const employee = await auth.models.Employee.findById(id)
    .select('firstName lastName email phone dateOfJoining employmentType lifecycle status dateOfLeaving createdAt emergencyContact bankDetails salary pfEnrollment esiEnrollment professionalTax tdsConfiguration healthInsurance documents department company')
    .lean()
  if (!employee) return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })

  const hydratedLifecycle = hydrateEmployeeLifecycle(employee)
  const onboardingEnabled = isFeatureEnabled(auth.companyFeatures, 'onboarding')
  const signals = onboardingEnabled
    ? await getOnboardingCompletionSignals({ models: auth.models, employee })
    : {}
  const reconciliation = reconcileOnboardingChecklist(hydratedLifecycle, signals)
  const lifecycle = reconciliation.lifecycle
  if (reconciliation.changed) {
    await auth.models.Employee.updateOne({ _id: employee._id }, { $set: { lifecycle } })
  }
  const workflows = await auth.models.HrmsWorkflow.find({ subjectEmployee: employee._id })
    .select('caseNumber module status dueAt completedAt')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean()

  return NextResponse.json({
    success: true,
    data: {
      lifecycle,
      progress: getLifecycleProgress(lifecycle),
      automation: { enabled: true, signals },
      workflows,
      permissions: {
        canManage: MANAGER_ROLES.has(auth.user?.role),
        canOffboard: HR_ROLES.has(auth.user?.role),
      },
      enabled: {
        onboarding: onboardingEnabled,
        probation: isFeatureEnabled(auth.companyFeatures, 'probation'),
        offboarding: isFeatureEnabled(auth.companyFeatures, 'exitManagement'),
      },
    },
  })
}

async function patchLifecycle(request, { params }) {
  const { id } = await params
  const { auth, response } = await authorize(request, id)
  if (response) return response

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, message: 'Invalid JSON request body' }, { status: 400 })
  }
  const action = String(body.action || '')
  const module = moduleForAction(action)
  if (!MANAGER_ROLES.has(auth.user?.role)) {
    return NextResponse.json({ success: false, message: 'HR or manager access is required' }, { status: 403 })
  }
  if (module === 'exitManagement' && !HR_ROLES.has(auth.user?.role)) {
    return NextResponse.json({ success: false, message: 'Only HR can manage offboarding' }, { status: 403 })
  }
  if (!isFeatureEnabled(auth.companyFeatures, module)) {
    return NextResponse.json({ success: false, message: 'This lifecycle feature is disabled for the tenant' }, { status: 403 })
  }

  const employee = await auth.models.Employee.findById(id)
  if (!employee) return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })

  const currentLifecycle = hydrateEmployeeLifecycle({
    ...employee.toObject(),
    lifecycle: employee.lifecycle?.toObject?.() || employee.lifecycle,
  })
  const onboardingEnabled = isFeatureEnabled(auth.companyFeatures, 'onboarding')
  const signals = onboardingEnabled
    ? await getOnboardingCompletionSignals({ models: auth.models, employee: employee.toObject() })
    : {}
  const reconciledLifecycle = reconcileOnboardingChecklist(currentLifecycle, signals).lifecycle
  let result
  try {
    result = applyLifecycleAction(reconciledLifecycle, action, body, { actorId: actorId(auth.user) })
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 400 })
  }

  employee.lifecycle = result.lifecycle
  Object.assign(employee, result.employeeUpdates)
  await employee.save()

  let workflowWarning = null
  try {
    let workflow = await auth.models.HrmsWorkflow.findOne({ subjectEmployee: employee._id, module }).sort({ createdAt: -1 })
    if (!workflow) {
      const moduleData = module === 'exitManagement'
        ? result.lifecycle.offboarding
        : module === 'probation'
          ? result.lifecycle.probation
          : result.lifecycle.onboarding
      const dueAt = module === 'exitManagement'
        ? result.lifecycle.offboarding.lastWorkingDate
        : module === 'probation'
          ? result.lifecycle.probation.reviewDate
          : result.lifecycle.onboarding.targetDate
      const created = await createWorkflow({
        Workflow: auth.models.HrmsWorkflow,
        Event: auth.models.HrmsWorkflowEvent,
        actor: auth.user,
        bypassPermission: true,
        allowIncompleteData: true,
        payload: {
          module,
          title: `${module === 'exitManagement' ? 'Offboarding' : module === 'probation' ? 'Probation' : 'Onboarding'}: ${employee.firstName} ${employee.lastName}`,
          subjectEmployee: employee._id,
          dueAt,
          data: moduleData,
          source: { entityType: 'Employee', entityId: employee._id },
          idempotencyKey: `employee:${employee._id}:${module}`,
        },
      })
      if (!created.success || !created.workflow) {
        throw new Error(created.message || created.errors?.[0]?.message || 'Workflow could not be created')
      }
      workflow = created.workflow
    }

    if (workflow) {
      const completed = action === 'confirm_probation'
        || action === 'complete_offboarding'
        || (action === 'complete_onboarding_item' && getLifecycleProgress(result.lifecycle).percentage === 100)
      const previousStatus = workflow.status
      workflow.status = completed ? 'completed' : 'in_progress'
      workflow.data = module === 'exitManagement' ? result.lifecycle.offboarding : module === 'probation' ? result.lifecycle.probation : result.lifecycle.onboarding
      workflow.dueAt = module === 'exitManagement' ? result.lifecycle.offboarding.lastWorkingDate : module === 'probation' ? result.lifecycle.probation.reviewDate : result.lifecycle.onboarding.targetDate
      workflow.completedAt = completed ? (workflow.completedAt || new Date()) : null
      workflow.updatedBy = actorId(auth.user)
      workflow.version = Number.isFinite(Number(workflow.version)) ? Number(workflow.version) + 1 : 1
      await workflow.save()
      await auth.models.HrmsWorkflowEvent.create({
        workflow: workflow._id,
        module,
        type: action,
        fromStatus: previousStatus,
        toStatus: workflow.status,
        actor: actorId(auth.user),
        comment: String(body.reason || '').slice(0, 2000),
        metadata: { source: 'employee_profile' },
      })
    }
  } catch (error) {
    workflowWarning = 'Lifecycle updated, but its workflow audit could not be synchronized'
    console.error('[EmployeeLifecycle] Workflow synchronization failed:', error)
  }

  await clearCachePattern(buildCachePattern({ tenantId: auth.tenant?.databaseName, namespace: 'employee:detail' })).catch(() => {})
  queryCache.clearPattern('employee')

  return NextResponse.json({
    success: true,
    message: workflowWarning || 'Employee lifecycle updated',
    warning: workflowWarning,
    data: { lifecycle: result.lifecycle, progress: getLifecycleProgress(result.lifecycle), automation: { enabled: true, signals } },
  })
}

function lifecycleErrorResponse(error, operation) {
  console.error(`[EmployeeLifecycle] ${operation} failed:`, error)
  return NextResponse.json(
    { success: false, message: `Unable to ${operation.toLowerCase()} employee lifecycle`, code: 'LIFECYCLE_ERROR' },
    { status: 500 },
  )
}

export async function GET(request, context) {
  try {
    return await getLifecycle(request, context)
  } catch (error) {
    return lifecycleErrorResponse(error, 'Load')
  }
}

export async function PATCH(request, context) {
  try {
    return await patchLifecycle(request, context)
  } catch (error) {
    return lifecycleErrorResponse(error, 'Update')
  }
}
