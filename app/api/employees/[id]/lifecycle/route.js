import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { clearCachePattern, buildCachePattern } from '@/lib/cache'
import queryCache from '@/lib/queryCache'
import { isFeatureEnabled } from '@/lib/planFeatures'
import { applyLifecycleAction, getLifecycleProgress, hydrateEmployeeLifecycle, reconcileOnboardingChecklist } from '@/lib/hrms/employeeLifecycle.server'
import { getOnboardingCompletionSignals } from '@/lib/hrms/onboardingProgress.server'
import { loadExitAssets } from '@/lib/hrms/resignationStore.server'
import { getLifecycleDatabase, persistLifecycleReview, syncLifecycleWorkflow } from '@/lib/hrms/lifecycleStore.server'
import { recordDigest } from '@/lib/platform/firestoreCodec.cjs'
import { isDirectReport } from '@/lib/teamScope'
import { resolveInductionProgram, progressId } from '@/lib/hrms/induction.server'
import { getNativeOnboardingKycEvidence } from '@/lib/hrms/onboardingKyc.server'

export const dynamic = 'force-dynamic'

const MANAGER_ROLES = new Set(['admin', 'hr', 'manager', 'department_head', 'superadmin', 'super_admin'])
const HR_ROLES = new Set(['admin', 'hr', 'superadmin', 'super_admin'])

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
    pip: approval.pip,
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

async function authorize(request, id) {
  if (!/^[a-f\d]{24}$/i.test(id || '')) {
    return { response: NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 }) }
  }
  const auth = await getAuthAndDatabase(request)
  if (!auth.success) {
    return { response: NextResponse.json({ success: false, message: auth.message || 'Unauthorized' }, { status: 401 }) }
  }
  const database = await getLifecycleDatabase(auth)
  if (!HR_ROLES.has(auth.user.role)) {
    const own = String(auth.user.employeeId?._id || auth.user.employeeId || '')
    if (own !== id) {
      const target = await database.get('employees', id)
      if (!MANAGER_ROLES.has(auth.user.role) || !isDirectReport(target, own)) {
        return { response: NextResponse.json({ success: false, message: 'You do not have access to this employee lifecycle' }, { status: 403 }) }
      }
    }
  }
  return { auth, database }
}

async function getLifecycle(request, { params }) {
  const { id } = await params
  const { auth, response, database } = await authorize(request, id)
  if (response) return response

  const employee = await database.get('employees', id)
  if (!employee) return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })

  const hydratedLifecycle = hydrateEmployeeLifecycle(employee)
  const inductionProgram = await resolveInductionProgram(database, employee.company)
  const currentAcknowledgement = inductionProgram ? await database.get('inductionprogresses', progressId(employee._id, inductionProgram.version)) : null
  const inductionAcknowledgedAt = currentAcknowledgement?.acknowledgedAt || ((!inductionProgram?.active || inductionProgram.version === employee.inductionCompletion?.version) ? employee.inductionCompletion?.acknowledgedAt : null)
  const inductionComplete = Boolean(inductionAcknowledgedAt)
  const onboardingEnabled = isFeatureEnabled(auth.companyFeatures, 'onboarding')
  const signals = onboardingEnabled
    ? await getOnboardingCompletionSignals({ database, employee })
    : {}
  const reconciliation = reconcileOnboardingChecklist(hydratedLifecycle, signals)
  let lifecycle = reconciliation.lifecycle
  let lifecycleChanged = reconciliation.changed
  if (lifecycle.offboarding?.status && lifecycle.offboarding.status !== 'not_started') {
    const clearance = await loadExitAssets(database, { ...employee, lifecycle: { ...employee.lifecycle, offboarding: lifecycle.offboarding } })
    lifecycle = { ...lifecycle, offboarding: clearance.offboarding }
    lifecycleChanged ||= clearance.changed
  }
  if (lifecycleChanged) {
    await database.transaction(async tx => {
      const current = await tx.get('employees', id)
      if (current && recordDigest(current) === recordDigest(employee)) await tx.replace('employees', { ...current, lifecycle, __v: Number(current.__v || 0) + 1, updatedAt: new Date() })
    })
  }
  if (!HR_ROLES.has(auth.user.role)) {
    for (const item of lifecycle.onboarding?.checklist || []) {
      if (item.submission?.verification?.details?.accountNumber) delete item.submission.verification.details.accountNumber
    }
  }
  const workflows = (await database.list('hrmsworkflows', { filters: [{ field: 'subjectEmployee', operator: '==', value: String(employee._id) }], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 50 })).records.map(({ _id, caseNumber, module, status, dueAt, completedAt }) => ({ _id, caseNumber, module, status, dueAt, completedAt }))
  const probationApproval = (await database.list('probationapprovals', { filters: [{ field: 'employee', operator: '==', value: String(employee._id) }], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 1 })).records[0]
  if (probationApproval) for (const field of ['approverEmployee', 'requestedByEmployee']) {
    const person = probationApproval[field] ? await database.get('employees', String(probationApproval[field])) : null
    probationApproval[field] = person ? { _id: person._id, firstName: person.firstName, lastName: person.lastName, employeeCode: person.employeeCode } : null
  }

  return NextResponse.json({
    success: true,
    data: {
      lifecycle,
      induction: { complete: inductionComplete, required: Boolean(inductionProgram?.active && !inductionComplete), acknowledgedAt: inductionAcknowledgedAt || null },
      employeeName: `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
      profilePhone: employee.phone || '',
      linkedEvidence: onboardingEnabled ? await getNativeOnboardingKycEvidence(database, employee._id) : {},
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
  const { auth, response, database } = await authorize(request, id)
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
  if (action === 'save_onboarding_letter' && !HR_ROLES.has(auth.user?.role)) {
    return NextResponse.json({ success: false, message: 'Only HR can prepare employment letters' }, { status: 403 })
  }
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
  const employee = await database.get('employees', id)
  if (!employee) return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })

  const currentLifecycle = hydrateEmployeeLifecycle(employee)
  if (currentLifecycle.offboarding?.resignationRequest && ['start_offboarding', 'complete_offboarding'].includes(action)) {
    return NextResponse.json({ success: false, message: 'Manage this linked resignation in Resignations & Exits to keep approvals, settlement and documents in sync.' }, { status: 409 })
  }
  if ((action === 'request_onboarding_changes' || (action === 'complete_onboarding_item' && currentLifecycle.onboarding?.checklist?.find(item => item.key === body.itemKey)?.submission)) && !HR_ROLES.has(auth.user.role)) {
    return NextResponse.json({ success: false, message: 'HR must review employee onboarding submissions' }, { status: 403 })
  }
  const onboardingEnabled = isFeatureEnabled(auth.companyFeatures, 'onboarding')
  const signals = onboardingEnabled
    ? await getOnboardingCompletionSignals({ database, employee })
    : {}
  let reconciledLifecycle = reconcileOnboardingChecklist(currentLifecycle, signals).lifecycle
  if (reconciledLifecycle.offboarding?.status && reconciledLifecycle.offboarding.status !== 'not_started') {
    const clearance = await loadExitAssets(database, { ...employee, lifecycle: { ...employee.lifecycle, offboarding: reconciledLifecycle.offboarding } })
    reconciledLifecycle = { ...reconciledLifecycle, offboarding: clearance.offboarding }
  }
  let result
  try {
    result = applyLifecycleAction(reconciledLifecycle, action, body, {
      actorId: actorId(auth.user),
      employee,
      linkedEvidence: action === 'complete_onboarding_item' && body.itemKey === 'documents' ? await getNativeOnboardingKycEvidence(database, employee._id) : {},
    })
    if (action === 'start_offboarding') {
      const clearance = await loadExitAssets(database, { ...employee, lifecycle: { ...employee.lifecycle, offboarding: result.lifecycle.offboarding } })
      result.lifecycle.offboarding = clearance.offboarding
    }
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 400 })
  }

  const persistedEmployee = await persistLifecycleReview(database, { employee, actor: auth.user, result, action, body })

  if (!persistedEmployee) {
    return NextResponse.json(
      { success: false, message: 'Employee changed while this action was being saved. Refresh and try again.', code: 'LIFECYCLE_CONFLICT' },
      { status: 409 },
    )
  }

  let workflowWarning = null
  try {
    await syncLifecycleWorkflow(database, { actor: auth.user, employee: persistedEmployee, lifecycle: result.lifecycle, moduleName, action, body })
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
