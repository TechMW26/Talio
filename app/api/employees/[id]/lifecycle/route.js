import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getAuthAndModels } from '@/lib/auth'
import { clearCachePattern, buildCachePattern } from '@/lib/cache'
import queryCache from '@/lib/queryCache'
import { isFeatureEnabled } from '@/lib/planFeatures'
import { applyLifecycleAction, getLifecycleProgress, hydrateEmployeeLifecycle, reconcileOnboardingChecklist } from '@/lib/hrms/employeeLifecycle.server'
import { getOnboardingCompletionSignals } from '@/lib/hrms/onboardingProgress.server'
import { loadOffboardingAssetClearance } from '@/lib/hrms/offboardingAssets.server'
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

function serializeProbationApproval(approval) {
  if (!approval) return null
  return {
    _id: approval._id,
    requestType: approval.requestType,
    extensionMonths: approval.extensionMonths,
    requestRemarks: approval.requestRemarks,
    status: approval.status,
    approverSource: approval.approverSource,
    approver: approval.approverEmployee,
    requester: approval.requestedByEmployee,
    decisionRemarks: approval.decisionRemarks,
    decidedAt: approval.decidedAt,
    createdAt: approval.createdAt,
    updatedAt: approval.updatedAt,
  }
}

async function persistOnboardingEvidenceDocuments({ Document, employee, actor, item }) {
  const documents = item?.verification?.documents || []
  if (!documents.length) return []
  const uploadedBy = mongoose.Types.ObjectId.isValid(actor?.employeeId)
    ? actor.employeeId
    : employee._id

  return Promise.all(documents.map((document) => Document.findOneAndUpdate(
    { employee: employee._id, fileId: document.fileId },
    {
      $setOnInsert: {
        name: document.fileName,
        type: document.fileType,
        url: document.fileUrl,
        fileName: document.fileName,
        fileType: document.fileType,
        fileUrl: document.fileUrl,
        fileId: document.fileId,
        fileSize: document.fileSize,
        employee: employee._id,
        uploadedBy,
        category: `onboarding_${document.requirementKey}`,
        isActive: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean()))
}

async function authorize(request, id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return { response: NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 }) }
  }
  const auth = await getAuthAndModels(request, ['Employee', 'HrmsWorkflow', 'HrmsWorkflowEvent', 'Document', 'Asset', 'Payroll', 'Policy', 'ProbationApproval'])
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
  let lifecycle = reconciliation.lifecycle
  let lifecycleChanged = reconciliation.changed
  if (lifecycle.offboarding?.status && lifecycle.offboarding.status !== 'not_started') {
    const clearance = await loadOffboardingAssetClearance({
      Asset: auth.models.Asset,
      employeeId: employee._id,
      offboarding: lifecycle.offboarding,
    })
    lifecycle = { ...lifecycle, offboarding: clearance.offboarding }
    lifecycleChanged ||= clearance.changed
  }
  if (lifecycleChanged) {
    await auth.models.Employee.updateOne({ _id: employee._id }, { $set: { lifecycle } })
  }
  const workflows = await auth.models.HrmsWorkflow.find({ subjectEmployee: employee._id })
    .select('caseNumber module status dueAt completedAt')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean()
  const probationApproval = await auth.models.ProbationApproval.findOne({ employee: employee._id })
    .sort({ createdAt: -1 })
    .populate('approverEmployee', 'firstName lastName employeeCode')
    .populate('requestedByEmployee', 'firstName lastName employeeCode')
    .lean()

  return NextResponse.json({
    success: true,
    data: {
      lifecycle,
      progress: getLifecycleProgress(lifecycle),
      automation: { enabled: true, signals },
      workflows,
      probationApproval: serializeProbationApproval(probationApproval),
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
  if (['confirm_probation', 'extend_probation'].includes(action)) {
    return NextResponse.json({
      success: false,
      message: 'Probation confirmation and extensions require the assigned manager approval workflow',
    }, { status: 409 })
  }
  const moduleName = moduleForAction(action)
  if (!MANAGER_ROLES.has(auth.user?.role)) {
    return NextResponse.json({ success: false, message: 'HR or manager access is required' }, { status: 403 })
  }
  if (moduleName === 'exitManagement' && !HR_ROLES.has(auth.user?.role)) {
    return NextResponse.json({ success: false, message: 'Only HR can manage offboarding' }, { status: 403 })
  }
  if (!isFeatureEnabled(auth.companyFeatures, moduleName)) {
    return NextResponse.json({ success: false, message: 'This lifecycle feature is disabled for the tenant' }, { status: 403 })
  }

  // Keep this read lean. Some older tenant records still contain legacy field
  // shapes (for example, a string address), and hydrating the whole document can
  // attach unrelated cast errors to it before a lifecycle action is applied.
  const employee = await auth.models.Employee.findById(id)
    .select('firstName lastName email phone dateOfJoining employmentType lifecycle status dateOfLeaving createdAt emergencyContact bankDetails salary documents department company __v')
    .lean()
  if (!employee) return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })

  const currentLifecycle = hydrateEmployeeLifecycle(employee)
  const onboardingEnabled = isFeatureEnabled(auth.companyFeatures, 'onboarding')
  const signals = onboardingEnabled
    ? await getOnboardingCompletionSignals({ models: auth.models, employee })
    : {}
  let reconciledLifecycle = reconcileOnboardingChecklist(currentLifecycle, signals).lifecycle
  if (reconciledLifecycle.offboarding?.status && reconciledLifecycle.offboarding.status !== 'not_started') {
    const clearance = await loadOffboardingAssetClearance({
      Asset: auth.models.Asset,
      employeeId: employee._id,
      offboarding: reconciledLifecycle.offboarding,
    })
    reconciledLifecycle = { ...reconciledLifecycle, offboarding: clearance.offboarding }
  }
  let result
  try {
    result = applyLifecycleAction(reconciledLifecycle, action, body, {
      actorId: actorId(auth.user),
      employee,
    })
    if (action === 'start_offboarding') {
      const clearance = await loadOffboardingAssetClearance({
        Asset: auth.models.Asset,
        employeeId: employee._id,
        offboarding: result.lifecycle.offboarding,
      })
      result.lifecycle.offboarding = clearance.offboarding
    }
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 400 })
  }

  if (action === 'complete_onboarding_item' && body.completed !== false) {
    const item = result.lifecycle.onboarding?.checklist?.find((entry) => entry.key === body.itemKey)
    try {
      await persistOnboardingEvidenceDocuments({
        Document: auth.models.Document,
        employee,
        actor: auth.user,
        item,
      })
    } catch (error) {
      console.error('[EmployeeLifecycle] Evidence document persistence failed:', error)
      return NextResponse.json({
        success: false,
        message: 'Verification files were uploaded, but could not be attached to the employee record. Please try again.',
        code: 'EVIDENCE_PERSISTENCE_FAILED',
      }, { status: 500 })
    }
  }

  // Persist only fields owned by the lifecycle action. Calling document.save()
  // here revalidates unrelated legacy employee fields and previously made every
  // lifecycle action fail when, for example, address was stored as a string.
  const persistedEmployee = await auth.models.Employee.findOneAndUpdate(
    { _id: employee._id, ...(Number.isInteger(employee.__v) ? { __v: employee.__v } : {}) },
    {
      $set: { lifecycle: result.lifecycle, ...result.employeeUpdates },
      $inc: { __v: 1 },
    },
    { new: true, runValidators: true, context: 'query' },
  ).select('_id firstName lastName').lean()

  if (!persistedEmployee) {
    return NextResponse.json(
      { success: false, message: 'Employee changed while this action was being saved. Refresh and try again.', code: 'LIFECYCLE_CONFLICT' },
      { status: 409 },
    )
  }

  let workflowWarning = null
  try {
    let workflow = await auth.models.HrmsWorkflow.findOne({ subjectEmployee: persistedEmployee._id, module: moduleName }).sort({ createdAt: -1 })
    if (!workflow) {
      const moduleData = moduleName === 'exitManagement'
        ? result.lifecycle.offboarding
        : moduleName === 'probation'
          ? result.lifecycle.probation
          : result.lifecycle.onboarding
      const dueAt = moduleName === 'exitManagement'
        ? result.lifecycle.offboarding.lastWorkingDate
        : moduleName === 'probation'
          ? result.lifecycle.probation.reviewDate
          : result.lifecycle.onboarding.targetDate
      const created = await createWorkflow({
        Workflow: auth.models.HrmsWorkflow,
        Event: auth.models.HrmsWorkflowEvent,
        actor: auth.user,
        bypassPermission: true,
        allowIncompleteData: true,
        payload: {
          module: moduleName,
          title: `${moduleName === 'exitManagement' ? 'Offboarding' : moduleName === 'probation' ? 'Probation' : 'Onboarding'}: ${persistedEmployee.firstName} ${persistedEmployee.lastName}`,
          subjectEmployee: persistedEmployee._id,
          dueAt,
          data: moduleData,
          source: { entityType: 'Employee', entityId: persistedEmployee._id },
          idempotencyKey: `employee:${persistedEmployee._id}:${moduleName}`,
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
      workflow.data = moduleName === 'exitManagement' ? result.lifecycle.offboarding : moduleName === 'probation' ? result.lifecycle.probation : result.lifecycle.onboarding
      workflow.dueAt = moduleName === 'exitManagement' ? result.lifecycle.offboarding.lastWorkingDate : moduleName === 'probation' ? result.lifecycle.probation.reviewDate : result.lifecycle.onboarding.targetDate
      workflow.completedAt = completed ? (workflow.completedAt || new Date()) : null
      workflow.updatedBy = actorId(auth.user)
      workflow.version = Number.isFinite(Number(workflow.version)) ? Number(workflow.version) + 1 : 1
      await workflow.save()
      await auth.models.HrmsWorkflowEvent.create({
        workflow: workflow._id,
        module: moduleName,
        type: action,
        fromStatus: previousStatus,
        toStatus: workflow.status,
        actor: actorId(auth.user),
        comment: String(body.reason || '').slice(0, 2000),
        metadata: {
          source: 'employee_profile',
          itemKey: body.itemKey || null,
          verificationMethod: body.verification ? 'manual' : null,
          evidenceDocumentCount: body.verification?.documents?.length || 0,
        },
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
